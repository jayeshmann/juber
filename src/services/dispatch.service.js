const { v4: uuidv4 } = require('uuid');
const { getRedisClient } = require('../db/redis');
const { query } = require('../db/postgres');
const config = require('../config');
const { latLngToGeoCell, getRegionFromCoordinates, calculateDistance } = require('../utils/geo.utils');
const driverLocationService = require('./driver-location.service');
const surgePricingService = require('./surge-pricing.service');
const { publishEvent } = require('../events/kafka-producer');
const topics = require('../events/topics');

class DispatchService {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Create a new ride request and initiate matching
   */
  async createRideRequest({
    riderId,
    pickup,
    destination,
    tier,
    paymentMethod,
    idempotencyKey
  }) {
    const region = getRegionFromCoordinates(pickup.lat, pickup.lng);
    const geoCell = latLngToGeoCell(pickup.lat, pickup.lng);

    // Increment demand counter for surge
    await surgePricingService.incrementDemand(geoCell, region);

    // Get current surge multiplier
    const surgeData = await surgePricingService.getSurgeForLocation(pickup.lat, pickup.lng);
    const surgeMultiplier = surgeData.surgeMultiplier;

    // Estimate fare
    const distanceKm = calculateDistance(pickup.lat, pickup.lng, destination.lat, destination.lng);
    const estimatedFare = this.calculateEstimatedFare(distanceKm, surgeMultiplier);

    // Create ride request in database
    const rideId = uuidv4();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minute expiry

    const insertResult = await query(
      `INSERT INTO ride_requests
       (id, rider_id, pickup_lat, pickup_lng, destination_lat, destination_lng,
        tier, payment_method, status, surge_multiplier, estimated_fare,
        idempotency_key, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'MATCHING', $9, $10, $11, $12)
       RETURNING *`,
      [
        rideId, riderId, pickup.lat, pickup.lng, destination.lat, destination.lng,
        tier, paymentMethod, surgeMultiplier, estimatedFare, idempotencyKey, expiresAt
      ]
    );

    const rideRequest = insertResult.rows[0];

    // Publish ride requested event
    await publishEvent(topics.RIDE_REQUESTED, rideId, {
      rideId,
      riderId,
      pickup,
      destination,
      tier,
      surgeMultiplier,
      region
    });

    // Initiate driver matching
    const matchResult = await this.matchDriver(rideRequest, region);

    return {
      id: rideId,
      status: 'MATCHING',
      riderId,
      pickup: { lat: pickup.lat, lng: pickup.lng },
      destination: { lat: destination.lat, lng: destination.lng },
      tier,
      surgeMultiplier,
      estimatedFare,
      matchedDriver: matchResult.driver,
      matchAttempts: 1
    };
  }

  /**
   * Match a driver to a ride request
   */
  async matchDriver(rideRequest, region) {
    const { id: rideId, pickup_lat, pickup_lng, tier } = rideRequest;

    // Find nearby available drivers
    const { drivers } = await driverLocationService.findNearbyDrivers({
      latitude: pickup_lat,
      longitude: pickup_lng,
      radiusKm: config.DEFAULT_SEARCH_RADIUS_KM,
      region,
      vehicleType: tier,
      limit: 10
    });

    if (drivers.length === 0) {
      // No drivers available
      await query(
        `UPDATE ride_requests SET status = 'NO_DRIVERS' WHERE id = $1`,
        [rideId]
      );
      return { driver: null, matched: false };
    }

    // Select best driver (nearest for now, could add rating scoring)
    const selectedDriver = drivers[0];

    // Create driver offer
    const offerId = uuidv4();
    const offerExpiresAt = new Date(Date.now() + config.DRIVER_RESPONSE_TIMEOUT);

    await query(
      `INSERT INTO driver_offers (id, ride_request_id, driver_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [offerId, rideId, selectedDriver.driverId, offerExpiresAt]
    );

    // Update ride request with current offer
    await query(
      `UPDATE ride_requests
       SET current_driver_offer_id = $1, driver_id = $2, match_attempts = match_attempts + 1
       WHERE id = $3`,
      [offerId, selectedDriver.driverId, rideId]
    );

    // Store offer in Redis for quick timeout checks
    await this.redis.set(
      `ride:${rideId}:offer`,
      JSON.stringify({
        offerId,
        driverId: selectedDriver.driverId,
        expiresAt: offerExpiresAt.toISOString()
      }),
      'EX',
      Math.ceil(config.DRIVER_RESPONSE_TIMEOUT / 1000) + 5
    );

    // Publish match event
    await publishEvent(topics.RIDE_MATCHED, rideId, {
      rideId,
      driverId: selectedDriver.driverId,
      offerId,
      distance: selectedDriver.distanceKm
    });

    return {
      driver: {
        driverId: selectedDriver.driverId,
        distanceKm: selectedDriver.distanceKm,
        eta: Math.ceil(selectedDriver.distanceKm * 2) // Rough ETA in minutes
      },
      matched: true
    };
  }

  /**
   * Handle driver response to ride offer
   */
  async handleDriverResponse(rideId, { driverId, action, reason }) {
    const rideResult = await query(
      `SELECT * FROM ride_requests WHERE id = $1`,
      [rideId]
    );

    if (rideResult.rows.length === 0) {
      throw new Error('Ride not found');
    }

    const ride = rideResult.rows[0];

    if (action === 'ACCEPT') {
      // Update ride status
      await query(
        `UPDATE ride_requests SET status = 'ACCEPTED', driver_id = $1 WHERE id = $2`,
        [driverId, rideId]
      );

      // Update driver offer
      await query(
        `UPDATE driver_offers
         SET status = 'ACCEPTED', responded_at = NOW()
         WHERE ride_request_id = $1 AND driver_id = $2`,
        [rideId, driverId]
      );

      // Update driver status
      await driverLocationService.updateDriverStatus(driverId, 'ON_TRIP');

      // Clear Redis offer
      await this.redis.del(`ride:${rideId}:offer`);

      // Publish acceptance event
      await publishEvent(topics.RIDE_ACCEPTED, rideId, { rideId, driverId });

      return { status: 'ACCEPTED', driverId };
    }

    if (action === 'DECLINE') {
      // Update driver offer
      await query(
        `UPDATE driver_offers
         SET status = 'DECLINED', responded_at = NOW(), decline_reason = $1
         WHERE ride_request_id = $2 AND driver_id = $3`,
        [reason || 'Not specified', rideId, driverId]
      );

      // Publish decline event
      await publishEvent(topics.RIDE_DECLINED, rideId, { rideId, driverId, reason });

      // Try to match next driver
      const region = getRegionFromCoordinates(ride.pickup_lat, ride.pickup_lng);

      // Check max attempts
      if (ride.match_attempts >= config.MAX_MATCH_ATTEMPTS) {
        await query(
          `UPDATE ride_requests SET status = 'EXPIRED' WHERE id = $1`,
          [rideId]
        );
        return { status: 'EXPIRED', reason: 'Max match attempts reached' };
      }

      // Find next driver (excluding declined ones)
      const declinedResult = await query(
        `SELECT driver_id FROM driver_offers
         WHERE ride_request_id = $1 AND status = 'DECLINED'`,
        [rideId]
      );
      const declinedDrivers = declinedResult.rows.map(r => r.driver_id);

      const { drivers } = await driverLocationService.findNearbyDrivers({
        latitude: ride.pickup_lat,
        longitude: ride.pickup_lng,
        radiusKm: config.DEFAULT_SEARCH_RADIUS_KM,
        region,
        vehicleType: ride.tier,
        limit: 10
      });

      const availableDrivers = drivers.filter(d => !declinedDrivers.includes(d.driverId));

      if (availableDrivers.length === 0) {
        await query(
          `UPDATE ride_requests SET status = 'EXPIRED' WHERE id = $1`,
          [rideId]
        );
        return { status: 'EXPIRED', reason: 'No available drivers' };
      }

      // Match next driver
      await this.matchDriver(ride, region);

      return { status: 'REASSIGNED' };
    }
  }

  /**
   * Get ride details
   */
  async getRideDetails(rideId) {
    const result = await query(
      `SELECT rr.*,
              do.id as offer_id, do.driver_id as current_offer_driver, do.status as offer_status
       FROM ride_requests rr
       LEFT JOIN driver_offers do ON rr.current_driver_offer_id = do.id
       WHERE rr.id = $1`,
      [rideId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const ride = result.rows[0];

    return {
      id: ride.id,
      riderId: ride.rider_id,
      status: ride.status,
      pickup: { lat: ride.pickup_lat, lng: ride.pickup_lng },
      destination: { lat: ride.destination_lat, lng: ride.destination_lng },
      tier: ride.tier,
      paymentMethod: ride.payment_method,
      surgeMultiplier: parseFloat(ride.surge_multiplier),
      estimatedFare: parseFloat(ride.estimated_fare),
      matchAttempts: ride.match_attempts,
      matchedDriver: ride.current_offer_driver ? {
        driverId: ride.current_offer_driver,
        offerStatus: ride.offer_status
      } : null,
      createdAt: ride.created_at,
      expiresAt: ride.expires_at
    };
  }

  /**
   * Check for driver timeout and reassign
   */
  async checkTimeout(rideId) {
    const offerData = await this.redis.get(`ride:${rideId}:offer`);
    if (!offerData) {
      return { timedOut: false };
    }

    const offer = JSON.parse(offerData);
    const expiresAt = new Date(offer.expiresAt);

    if (new Date() > expiresAt) {
      // Timeout occurred, treat as decline
      await this.handleDriverResponse(rideId, {
        driverId: offer.driverId,
        action: 'DECLINE',
        reason: 'Timeout'
      });
      return { timedOut: true };
    }

    return { timedOut: false };
  }

  /**
   * Calculate estimated fare
   */
  calculateEstimatedFare(distanceKm, surgeMultiplier) {
    const baseFare = config.FARE_BASE;
    const distanceFare = distanceKm * config.FARE_PER_KM;
    const estimatedMinutes = distanceKm * 3; // Rough estimate
    const timeFare = estimatedMinutes * config.FARE_PER_MINUTE;

    const subtotal = baseFare + distanceFare + timeFare;
    const total = subtotal * surgeMultiplier;

    return Math.round(total * 100) / 100;
  }
}

module.exports = new DispatchService();
