const { getRedisClient } = require('../db/redis');
const config = require('../config');
const { latLngToGeoCell, getRegionFromCoordinates } = require('../utils/geo.utils');
const { publishEvent } = require('../events/kafka-producer');
const topics = require('../events/topics');

class DriverLocationService {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Update driver's current location
   * Stores in Redis GEO index for proximity searches
   */
  async updateLocation(driverId, { latitude, longitude, timestamp, heading, speed }) {
    const region = getRegionFromCoordinates(latitude, longitude);
    const geoCell = latLngToGeoCell(latitude, longitude);
    const geoKey = `drivers:locations:${region}`;
    const presenceKey = `driver:${driverId}:presence`;
    const metaKey = `driver:${driverId}:meta`;

    // Add to geo index
    await this.redis.geoadd(geoKey, longitude, latitude, driverId);

    // Set presence with TTL (driver is considered offline after TTL expires)
    await this.redis.set(presenceKey, '1', 'EX', config.DRIVER_PRESENCE_TTL);

    // Update metadata
    await this.redis.hset(metaKey,
      'lastLat', latitude.toString(),
      'lastLng', longitude.toString(),
      'lastUpdate', timestamp || new Date().toISOString(),
      'heading', (heading || 0).toString(),
      'speed', (speed || 0).toString(),
      'geoCell', geoCell
    );

    // Publish location update event (for analytics, etc.)
    await publishEvent(topics.DRIVER_LOCATION_UPDATED, driverId, {
      driverId,
      latitude,
      longitude,
      geoCell,
      region,
      timestamp: timestamp || new Date().toISOString()
    });

    return { success: true, driverId, geoCell, region };
  }

  /**
   * Find drivers near a location
   * Uses Redis GEORADIUS for efficient proximity search
   */
  async findNearbyDrivers({ latitude, longitude, radiusKm, region, vehicleType, limit = 20 }) {
    const geoKey = `drivers:locations:${region}`;

    // Get drivers within radius, sorted by distance
    const results = await this.redis.georadius(
      geoKey,
      longitude,
      latitude,
      radiusKm,
      'km',
      'WITHDIST',
      'WITHCOORD',
      'ASC',
      'COUNT',
      limit * 2 // Get extra to filter
    );

    const drivers = [];

    for (const [driverId, distance, [lng, lat]] of results) {
      // Check if driver is online (presence key exists)
      const isOnline = await this.redis.exists(`driver:${driverId}:presence`);
      if (!isOnline) continue;

      // Get driver metadata
      const meta = await this.redis.hgetall(`driver:${driverId}:meta`);
      if (meta.status !== 'ONLINE') continue;

      // Filter by vehicle type if specified
      const driverVehicleType = meta.vehicleType || 'ECONOMY';
      if (vehicleType && driverVehicleType !== vehicleType) continue;

      drivers.push({
        driverId,
        distanceKm: parseFloat(distance),
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        vehicleType: meta.vehicleType || 'ECONOMY',
        status: meta.status,
        heading: parseFloat(meta.heading) || 0,
        speed: parseFloat(meta.speed) || 0
      });

      if (drivers.length >= limit) break;
    }

    return { drivers, count: drivers.length };
  }

  /**
   * Update driver status (ONLINE, OFFLINE, ON_TRIP)
   */
  async updateDriverStatus(driverId, status) {
    const metaKey = `driver:${driverId}:meta`;
    await this.redis.hset(metaKey, 'status', status);

    await publishEvent(topics.DRIVER_STATUS_CHANGED, driverId, {
      driverId,
      status,
      timestamp: new Date().toISOString()
    });

    return { driverId, status };
  }

  /**
   * Check if driver is online (has recent location updates)
   */
  async isDriverOnline(driverId) {
    const presenceKey = `driver:${driverId}:presence`;
    return await this.redis.exists(presenceKey) === 1;
  }

  /**
   * Get driver's current location
   */
  async getDriverLocation(driverId, region = 'bangalore') {
    const geoKey = `drivers:locations:${region}`;
    const position = await this.redis.geopos(geoKey, driverId);

    if (!position[0]) return null;

    const meta = await this.redis.hgetall(`driver:${driverId}:meta`);

    return {
      driverId,
      latitude: parseFloat(position[0][1]),
      longitude: parseFloat(position[0][0]),
      ...meta
    };
  }
}

module.exports = new DriverLocationService();
