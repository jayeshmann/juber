const { getRedisClient } = require('../db/redis');
const config = require('../config');
const { latLngToGeoCell, getNeighboringCells } = require('../utils/geo.utils');
const { publishEvent } = require('../events/kafka-producer');
const topics = require('../events/topics');

class SurgePricingService {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Get surge multiplier for a geo cell
   */
  async getSurgeForCell(geoCell) {
    const cacheKey = `surge:${geoCell}`;
    const cached = await this.redis.hgetall(cacheKey);

    if (cached && cached.multiplier) {
      return {
        geoCell,
        surgeMultiplier: parseFloat(cached.multiplier),
        supplyCount: parseInt(cached.supply) || 0,
        demandCount: parseInt(cached.demand) || 0,
        updatedAt: cached.updatedAt
      };
    }

    // Return default if no data
    return {
      geoCell,
      surgeMultiplier: config.SURGE_MIN,
      supplyCount: 0,
      demandCount: 0
    };
  }

  /**
   * Calculate and cache surge pricing for a geo cell
   */
  async calculateSurge({ geoCell, region, latitude, longitude }) {
    // Get supply: count of online drivers in area
    const supplyCount = await this.getSupplyCount(region, latitude, longitude);

    // Get demand: count of recent ride requests
    const demandKey = `demand:${geoCell}`;
    const demandCount = parseInt(await this.redis.get(demandKey)) || 0;

    // Calculate surge multiplier
    const surgeMultiplier = this.computeSurgeMultiplier(supplyCount, demandCount);

    // Cache the result
    const cacheKey = `surge:${geoCell}`;
    const validUntil = new Date(Date.now() + config.SURGE_CACHE_TTL * 1000).toISOString();

    await this.redis.hset(cacheKey,
      'multiplier', surgeMultiplier.toString(),
      'supply', supplyCount.toString(),
      'demand', demandCount.toString(),
      'region', region,
      'updatedAt', new Date().toISOString()
    );
    await this.redis.expire(cacheKey, config.SURGE_CACHE_TTL);

    // Track cell in region set
    await this.redis.sadd(`surge:cells:${region}`, geoCell);

    // Publish surge update event
    await publishEvent(topics.SURGE_UPDATED, geoCell, {
      geoCell,
      region,
      surgeMultiplier,
      supplyCount,
      demandCount
    });

    return {
      geoCell,
      surgeMultiplier,
      supplyCount,
      demandCount,
      validUntil
    };
  }

  /**
   * Compute surge multiplier based on supply/demand ratio
   * Formula: surge = 1.0 + (demand/supply - 1) * smoothingFactor
   * Clamped between SURGE_MIN and SURGE_MAX
   */
  computeSurgeMultiplier(supply, demand) {
    if (supply === 0 && demand === 0) {
      return config.SURGE_MIN;
    }

    if (supply === 0) {
      return config.SURGE_MAX;
    }

    const ratio = demand / supply;
    const smoothingFactor = 0.5; // Dampen price swings

    // Apply smoothing: don't jump straight to ratio
    let surge = 1.0 + (ratio - 1) * smoothingFactor;

    // Clamp to min/max
    surge = Math.max(config.SURGE_MIN, surge);
    surge = Math.min(config.SURGE_MAX, surge);

    // Round to 1 decimal place
    return Math.round(surge * 10) / 10;
  }

  /**
   * Get count of online drivers near a location
   */
  async getSupplyCount(region, latitude, longitude) {
    const geoKey = `drivers:locations:${region}`;
    const radiusKm = 2; // 2km radius for supply count

    const results = await this.redis.georadius(
      geoKey,
      longitude,
      latitude,
      radiusKm,
      'km'
    );

    // Filter to only online drivers
    let onlineCount = 0;
    for (const driverId of results) {
      const isOnline = await this.redis.exists(`driver:${driverId}:presence`);
      if (isOnline) {
        const status = await this.redis.hget(`driver:${driverId}:meta`, 'status');
        if (status === 'ONLINE') onlineCount++;
      }
    }

    return onlineCount;
  }

  /**
   * Increment demand counter for a geo cell
   */
  async incrementDemand(geoCell, region) {
    const demandKey = `demand:${geoCell}`;
    const count = await this.redis.incr(demandKey);

    // Set TTL on first increment
    if (count === 1) {
      await this.redis.expire(demandKey, config.DEMAND_COUNTER_TTL);
    }

    return { geoCell, demandCount: count };
  }

  /**
   * Get all surge zones for a region
   */
  async getSurgeZonesForRegion(region, minSurge = 1.0) {
    const cellSet = `surge:cells:${region}`;
    const cells = await this.redis.smembers(cellSet);

    const zones = [];
    for (const cell of cells) {
      const data = await this.getSurgeForCell(cell);
      if (data.surgeMultiplier >= minSurge) {
        zones.push(data);
      }
    }

    // Sort by surge descending
    zones.sort((a, b) => b.surgeMultiplier - a.surgeMultiplier);

    return { region, zones };
  }

  /**
   * Get surge for a pickup location (checks cell and neighbors)
   */
  async getSurgeForLocation(latitude, longitude) {
    const geoCell = latLngToGeoCell(latitude, longitude);
    const data = await this.getSurgeForCell(geoCell);

    // If no cached data, calculate it
    if (data.supplyCount === 0 && data.demandCount === 0) {
      const region = require('../utils/geo.utils').getRegionFromCoordinates(latitude, longitude);
      return this.calculateSurge({ geoCell, region, latitude, longitude });
    }

    return data;
  }
}

module.exports = new SurgePricingService();
