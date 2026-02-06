const { v4: uuidv4 } = require('uuid');
const { query, getClient } = require('../db/postgres');
const { getRedisClient } = require('../db/redis');
const config = require('../config');
const driverLocationService = require('./driver-location.service');
const { publishEvent } = require('../events/kafka-producer');
const topics = require('../events/topics');

class TripService {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Create a trip from an accepted ride request
   */
  async createTrip(rideRequestId) {
    // Verify ride is in ACCEPTED status
    const rideResult = await query(
      `SELECT * FROM ride_requests WHERE id = $1 AND status = 'ACCEPTED'`,
      [rideRequestId]
    );

    if (rideResult.rows.length === 0) {
      throw new Error('Invalid or unaccepted ride request');
    }

    const ride = rideResult.rows[0];

    // Check if trip already exists
    const existingTrip = await query(
      `SELECT id FROM trips WHERE ride_request_id = $1`,
      [rideRequestId]
    );

    if (existingTrip.rows.length > 0) {
      return this.getTripById(existingTrip.rows[0].id);
    }

    const tripId = uuidv4();

    await query(
      `INSERT INTO trips (id, ride_request_id, driver_id, rider_id, status, surge_multiplier)
       VALUES ($1, $2, $3, $4, 'PENDING', $5)`,
      [tripId, rideRequestId, ride.driver_id, ride.rider_id, ride.surge_multiplier]
    );

    // Publish event
    await publishEvent(topics.TRIP_CREATED, tripId, {
      tripId,
      rideRequestId,
      driverId: ride.driver_id,
      riderId: ride.rider_id
    });

    return {
      id: tripId,
      rideRequestId,
      status: 'PENDING',
      driverId: ride.driver_id,
      riderId: ride.rider_id
    };
  }

  /**
   * Start a trip
   */
  async startTrip(tripId, { startLat, startLng }) {
    const trip = await this.getTripById(tripId);

    if (!trip) {
      throw new Error('Trip not found');
    }

    if (trip.status !== 'PENDING') {
      throw new Error(`Cannot start trip in ${trip.status} status`);
    }

    const startTime = new Date();

    await query(
      `UPDATE trips
       SET status = 'STARTED', start_time = $1, start_lat = $2, start_lng = $3, updated_at = NOW()
       WHERE id = $4`,
      [startTime, startLat, startLng, tripId]
    );

    // Update driver status
    await driverLocationService.updateDriverStatus(trip.driverId, 'ON_TRIP');

    // Publish event
    await publishEvent(topics.TRIP_STARTED, tripId, {
      tripId,
      driverId: trip.driverId,
      startTime: startTime.toISOString(),
      startLocation: { lat: startLat, lng: startLng }
    });

    return {
      id: tripId,
      status: 'STARTED',
      startTime: startTime.toISOString(),
      startLat,
      startLng
    };
  }

  /**
   * Pause a trip
   */
  async pauseTrip(tripId, reason) {
    const trip = await this.getTripById(tripId);

    if (!trip) {
      throw new Error('Trip not found');
    }

    if (trip.status !== 'STARTED') {
      throw new Error(`Cannot pause trip in ${trip.status} status`);
    }

    const pauseTime = new Date();

    await query(
      `UPDATE trips SET status = 'PAUSED', pause_time = $1, updated_at = NOW() WHERE id = $2`,
      [pauseTime, tripId]
    );

    await publishEvent(topics.TRIP_PAUSED, tripId, { tripId, pauseTime: pauseTime.toISOString(), reason });

    return {
      id: tripId,
      status: 'PAUSED',
      pauseTime: pauseTime.toISOString()
    };
  }

  /**
   * Resume a paused trip
   */
  async resumeTrip(tripId) {
    const tripResult = await query(`SELECT * FROM trips WHERE id = $1`, [tripId]);

    if (tripResult.rows.length === 0) {
      throw new Error('Trip not found');
    }

    const trip = tripResult.rows[0];

    if (trip.status !== 'PAUSED') {
      throw new Error(`Cannot resume trip in ${trip.status} status`);
    }

    const pauseDuration = trip.pause_time
      ? Math.floor((Date.now() - new Date(trip.pause_time).getTime()) / 1000)
      : 0;

    const totalPauseDuration = (trip.total_pause_duration || 0) + pauseDuration;

    await query(
      `UPDATE trips
       SET status = 'STARTED', pause_time = NULL, total_pause_duration = $1, updated_at = NOW()
       WHERE id = $2`,
      [totalPauseDuration, tripId]
    );

    await publishEvent(topics.TRIP_RESUMED, tripId, { tripId, totalPauseDuration });

    return {
      id: tripId,
      status: 'STARTED',
      totalPauseDuration
    };
  }

  /**
   * End a trip and calculate fare
   */
  async endTrip(tripId, { endLat, endLng, distanceKm, durationMinutes }) {
    const tripResult = await query(`SELECT * FROM trips WHERE id = $1`, [tripId]);

    if (tripResult.rows.length === 0) {
      throw new Error('Trip not found');
    }

    const trip = tripResult.rows[0];

    if (trip.status !== 'STARTED' && trip.status !== 'PAUSED') {
      throw new Error(`Cannot end trip in ${trip.status} status`);
    }

    // Calculate fare
    const fare = this.calculateFare(distanceKm, durationMinutes, parseFloat(trip.surge_multiplier));
    const endTime = new Date();

    await query(
      `UPDATE trips
       SET status = 'COMPLETED', end_time = $1, end_lat = $2, end_lng = $3,
           distance_km = $4, duration_minutes = $5,
           base_fare = $6, distance_fare = $7, time_fare = $8, total_fare = $9,
           updated_at = NOW()
       WHERE id = $10`,
      [
        endTime, endLat, endLng, distanceKm, durationMinutes,
        fare.baseFare, fare.distanceFare, fare.timeFare, fare.totalFare,
        tripId
      ]
    );

    // Update driver status back to ONLINE
    await driverLocationService.updateDriverStatus(trip.driver_id, 'ONLINE');

    // Publish event
    await publishEvent(topics.TRIP_COMPLETED, tripId, {
      tripId,
      driverId: trip.driver_id,
      riderId: trip.rider_id,
      fare: fare.totalFare,
      distanceKm,
      durationMinutes
    });

    return {
      id: tripId,
      status: 'COMPLETED',
      endTime: endTime.toISOString(),
      distanceKm,
      durationMinutes,
      fare
    };
  }

  /**
   * Cancel a trip
   */
  async cancelTrip(tripId, { cancelledBy, reason }) {
    const trip = await this.getTripById(tripId);

    if (!trip) {
      throw new Error('Trip not found');
    }

    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') {
      throw new Error(`Cannot cancel trip in ${trip.status} status`);
    }

    // Calculate cancellation fee (only if trip was started)
    const cancellationFee = trip.status === 'STARTED' || trip.status === 'PAUSED'
      ? config.CANCELLATION_FEE
      : 0;

    await query(
      `UPDATE trips SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`,
      [tripId]
    );

    // Update driver status back to ONLINE
    await driverLocationService.updateDriverStatus(trip.driverId, 'ONLINE');

    // Publish event
    await publishEvent(topics.TRIP_CANCELLED, tripId, {
      tripId,
      cancelledBy,
      reason,
      cancellationFee
    });

    return {
      id: tripId,
      status: 'CANCELLED',
      cancellationFee,
      cancelledBy,
      reason
    };
  }

  /**
   * Generate trip receipt
   */
  async generateReceipt(tripId) {
    const tripResult = await query(
      `SELECT t.*,
              r.name as rider_name, r.phone as rider_phone,
              d.name as driver_name, d.phone as driver_phone, d.license_plate
       FROM trips t
       JOIN riders r ON t.rider_id = r.id
       JOIN drivers d ON t.driver_id = d.id
       WHERE t.id = $1`,
      [tripId]
    );

    if (tripResult.rows.length === 0) {
      throw new Error('Trip not found');
    }

    const trip = tripResult.rows[0];

    if (trip.status !== 'COMPLETED') {
      throw new Error('Receipt only available for completed trips');
    }

    return {
      tripId,
      riderName: trip.rider_name,
      driverName: trip.driver_name,
      driverLicensePlate: trip.license_plate,
      pickup: { lat: parseFloat(trip.start_lat), lng: parseFloat(trip.start_lng) },
      destination: { lat: parseFloat(trip.end_lat), lng: parseFloat(trip.end_lng) },
      distance: `${trip.distance_km} km`,
      duration: `${trip.duration_minutes} min`,
      fareBreakdown: {
        baseFare: `₹${trip.base_fare}`,
        distanceFare: `₹${trip.distance_fare}`,
        timeFare: `₹${trip.time_fare}`,
        surgeMultiplier: `${trip.surge_multiplier}x`,
        total: `₹${trip.total_fare}`
      },
      paymentMethod: 'CARD', // Could fetch from ride request
      startTime: trip.start_time,
      endTime: trip.end_time,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Calculate fare breakdown
   */
  calculateFare(distanceKm, durationMinutes, surgeMultiplier) {
    const baseFare = config.FARE_BASE;
    const distanceFare = Math.round(distanceKm * config.FARE_PER_KM * 100) / 100;
    const timeFare = Math.round(durationMinutes * config.FARE_PER_MINUTE * 100) / 100;

    const subtotal = baseFare + distanceFare + timeFare;
    const totalFare = Math.round(subtotal * surgeMultiplier * 100) / 100;

    return {
      baseFare,
      distanceFare,
      timeFare,
      surgeMultiplier,
      totalFare
    };
  }

  /**
   * Get trip by ID
   */
  async getTripById(tripId) {
    const result = await query(`SELECT * FROM trips WHERE id = $1`, [tripId]);

    if (result.rows.length === 0) {
      return null;
    }

    const trip = result.rows[0];

    return {
      id: trip.id,
      rideRequestId: trip.ride_request_id,
      driverId: trip.driver_id,
      riderId: trip.rider_id,
      status: trip.status,
      startTime: trip.start_time,
      endTime: trip.end_time,
      pauseTime: trip.pause_time,
      totalPauseDuration: trip.total_pause_duration || 0,
      startLat: trip.start_lat ? parseFloat(trip.start_lat) : null,
      startLng: trip.start_lng ? parseFloat(trip.start_lng) : null,
      endLat: trip.end_lat ? parseFloat(trip.end_lat) : null,
      endLng: trip.end_lng ? parseFloat(trip.end_lng) : null,
      distanceKm: trip.distance_km ? parseFloat(trip.distance_km) : null,
      durationMinutes: trip.duration_minutes,
      surgeMultiplier: trip.surge_multiplier ? parseFloat(trip.surge_multiplier) : 1.0,
      fare: trip.total_fare ? {
        baseFare: parseFloat(trip.base_fare),
        distanceFare: parseFloat(trip.distance_fare),
        timeFare: parseFloat(trip.time_fare),
        totalFare: parseFloat(trip.total_fare)
      } : null
    };
  }
}

module.exports = new TripService();
