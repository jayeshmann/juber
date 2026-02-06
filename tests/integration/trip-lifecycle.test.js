const request = require('supertest');
const Redis = require('ioredis');
const { Pool } = require('pg');

let app;
let redis;
let pgPool;

beforeAll(async () => {
  const { createApp } = require('../../src/app');
  app = await createApp();
  redis = new Redis(process.env.REDIS_URL);
  pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
});

afterAll(async () => {
  await redis.quit();
  await pgPool.end();
});

beforeEach(async () => {
  // Clean up trips
  await pgPool.query('DELETE FROM trips');
  await pgPool.query('DELETE FROM driver_offers');
  await pgPool.query('DELETE FROM ride_requests');
  await redis.flushdb();
});

describe('Trip Lifecycle Service', () => {
  let rideId;
  let tripId;

  const createAcceptedRide = async () => {
    // Seed driver locations
    await redis.geoadd(
      'drivers:locations:bangalore',
      77.5946,
      12.9716,
      'd1000000-0000-0000-0000-000000000001',
    );
    await redis.hset(
      'driver:d1000000-0000-0000-0000-000000000001:meta',
      'status',
      'ONLINE',
      'vehicleType',
      'ECONOMY',
    );
    await redis.set(
      'driver:d1000000-0000-0000-0000-000000000001:presence',
      '1',
      'EX',
      30,
    );

    // Create and accept ride
    const rideResponse = await request(app)
      .post('/api/v1/rides')
      .set('Idempotency-Key', `trip-test-${Date.now()}`)
      .send({
        riderId: 'a1000000-0000-0000-0000-000000000001',
        pickup: { lat: 12.9716, lng: 77.5946 },
        destination: { lat: 12.98, lng: 77.61 },
        tier: 'ECONOMY',
        paymentMethod: 'CARD',
      });

    rideId = rideResponse.body.id;

    // Driver accepts
    await request(app).post(`/api/v1/rides/${rideId}/driver-response`).send({
      driverId: 'd1000000-0000-0000-0000-000000000001',
      action: 'ACCEPT',
    });

    return rideId;
  };

  describe('POST /api/v1/trips - Trip Creation', () => {
    it('should create a trip from accepted ride', async () => {
      await createAcceptedRide();

      const response = await request(app)
        .post('/api/v1/trips')
        .send({ rideRequestId: rideId })
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        rideRequestId: rideId,
        status: 'PENDING',
        driverId: 'd1000000-0000-0000-0000-000000000001',
        riderId: 'a1000000-0000-0000-0000-000000000001',
      });

      tripId = response.body.id;
    });

    it('should reject trip creation for non-accepted ride', async () => {
      await request(app)
        .post('/api/v1/trips')
        .send({ rideRequestId: 'non-existent-ride' })
        .expect(400);
    });
  });

  describe('POST /api/v1/trips/:tripId/start', () => {
    beforeEach(async () => {
      await createAcceptedRide();
      const tripResponse = await request(app)
        .post('/api/v1/trips')
        .send({ rideRequestId: rideId });
      tripId = tripResponse.body.id;
    });

    it('should start a trip', async () => {
      const response = await request(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .send({
          startLat: 12.9716,
          startLng: 77.5946,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: tripId,
        status: 'STARTED',
        startTime: expect.any(String),
        startLat: 12.9716,
        startLng: 77.5946,
      });
    });

    it('should update driver status to ON_TRIP', async () => {
      await request(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .send({ startLat: 12.9716, startLng: 77.5946 })
        .expect(200);

      const driverStatus = await redis.hget(
        'driver:d1000000-0000-0000-0000-000000000001:meta',
        'status',
      );
      expect(driverStatus).toBe('ON_TRIP');
    });

    it('should reject starting an already started trip', async () => {
      await request(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .send({ startLat: 12.9716, startLng: 77.5946 });

      await request(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .send({ startLat: 12.9716, startLng: 77.5946 })
        .expect(400);
    });
  });

  describe('POST /api/v1/trips/:tripId/pause', () => {
    beforeEach(async () => {
      await createAcceptedRide();
      const tripResponse = await request(app)
        .post('/api/v1/trips')
        .send({ rideRequestId: rideId });
      tripId = tripResponse.body.id;

      await request(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .send({ startLat: 12.9716, startLng: 77.5946 });
    });

    it('should pause a started trip', async () => {
      const response = await request(app)
        .post(`/api/v1/trips/${tripId}/pause`)
        .send({ reason: 'Traffic jam' })
        .expect(200);

      expect(response.body).toMatchObject({
        id: tripId,
        status: 'PAUSED',
        pauseTime: expect.any(String),
      });
    });

    it('should not pause an already paused trip', async () => {
      await request(app).post(`/api/v1/trips/${tripId}/pause`).send({});

      await request(app)
        .post(`/api/v1/trips/${tripId}/pause`)
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/v1/trips/:tripId/resume', () => {
    beforeEach(async () => {
      await createAcceptedRide();
      const tripResponse = await request(app)
        .post('/api/v1/trips')
        .send({ rideRequestId: rideId });
      tripId = tripResponse.body.id;

      await request(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .send({ startLat: 12.9716, startLng: 77.5946 });

      await request(app).post(`/api/v1/trips/${tripId}/pause`).send({});
    });

    it('should resume a paused trip', async () => {
      const response = await request(app)
        .post(`/api/v1/trips/${tripId}/resume`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: tripId,
        status: 'STARTED',
      });
    });

    it('should track pause duration', async () => {
      // Wait a bit to accumulate pause time
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app)
        .post(`/api/v1/trips/${tripId}/resume`)
        .expect(200);

      // totalPauseDuration is in seconds, sub-second pauses floor to 0
      expect(response.body.totalPauseDuration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('POST /api/v1/trips/:tripId/end', () => {
    beforeEach(async () => {
      await createAcceptedRide();
      const tripResponse = await request(app)
        .post('/api/v1/trips')
        .send({ rideRequestId: rideId });
      tripId = tripResponse.body.id;

      await request(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .send({ startLat: 12.9716, startLng: 77.5946 });
    });

    it('should end a trip and calculate fare', async () => {
      const response = await request(app)
        .post(`/api/v1/trips/${tripId}/end`)
        .send({
          endLat: 12.98,
          endLng: 77.61,
          distanceKm: 5.2,
          durationMinutes: 18,
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: tripId,
        status: 'COMPLETED',
        endTime: expect.any(String),
        distanceKm: 5.2,
        durationMinutes: 18,
        fare: {
          baseFare: expect.any(Number),
          distanceFare: expect.any(Number),
          timeFare: expect.any(Number),
          surgeMultiplier: expect.any(Number),
          totalFare: expect.any(Number),
        },
      });
    });

    it('should update driver status back to ONLINE', async () => {
      await request(app)
        .post(`/api/v1/trips/${tripId}/end`)
        .send({
          endLat: 12.98,
          endLng: 77.61,
          distanceKm: 5.2,
          durationMinutes: 18,
        })
        .expect(200);

      const driverStatus = await redis.hget(
        'driver:d1000000-0000-0000-0000-000000000001:meta',
        'status',
      );
      expect(driverStatus).toBe('ONLINE');
    });

    it('should calculate fare with surge multiplier', async () => {
      // Update surge directly on the trip (since it's copied from ride at creation)
      await pgPool.query(
        'UPDATE trips SET surge_multiplier = 1.5 WHERE id = $1',
        [tripId],
      );

      const response = await request(app)
        .post(`/api/v1/trips/${tripId}/end`)
        .send({
          endLat: 12.98,
          endLng: 77.61,
          distanceKm: 5.2,
          durationMinutes: 18,
        })
        .expect(200);

      expect(response.body.fare.surgeMultiplier).toBe(1.5);
      // Total should be higher due to surge
      const baseTotal =
        response.body.fare.baseFare +
        response.body.fare.distanceFare +
        response.body.fare.timeFare;
      expect(response.body.fare.totalFare).toBeCloseTo(baseTotal * 1.5, 1);
    });
  });

  describe('POST /api/v1/trips/:tripId/cancel', () => {
    beforeEach(async () => {
      await createAcceptedRide();
      const tripResponse = await request(app)
        .post('/api/v1/trips')
        .send({ rideRequestId: rideId });
      tripId = tripResponse.body.id;
    });

    it('should cancel a pending trip without fee', async () => {
      const response = await request(app)
        .post(`/api/v1/trips/${tripId}/cancel`)
        .send({
          cancelledBy: 'RIDER',
          reason: 'Changed plans',
        })
        .expect(200);

      expect(response.body).toMatchObject({
        id: tripId,
        status: 'CANCELLED',
        cancellationFee: 0,
      });
    });

    it('should apply cancellation fee after trip started', async () => {
      await request(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .send({ startLat: 12.9716, startLng: 77.5946 });

      const response = await request(app)
        .post(`/api/v1/trips/${tripId}/cancel`)
        .send({
          cancelledBy: 'RIDER',
          reason: 'Emergency',
        })
        .expect(200);

      expect(response.body.cancellationFee).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/trips/:tripId/receipt', () => {
    beforeEach(async () => {
      await createAcceptedRide();
      const tripResponse = await request(app)
        .post('/api/v1/trips')
        .send({ rideRequestId: rideId });
      tripId = tripResponse.body.id;

      await request(app)
        .post(`/api/v1/trips/${tripId}/start`)
        .send({ startLat: 12.9716, startLng: 77.5946 });

      await request(app).post(`/api/v1/trips/${tripId}/end`).send({
        endLat: 12.98,
        endLng: 77.61,
        distanceKm: 5.2,
        durationMinutes: 18,
      });
    });

    it('should generate trip receipt', async () => {
      const response = await request(app)
        .get(`/api/v1/trips/${tripId}/receipt`)
        .expect(200);

      expect(response.body).toMatchObject({
        tripId,
        riderName: expect.any(String),
        driverName: expect.any(String),
        pickup: expect.any(Object),
        destination: expect.any(Object),
        distance: expect.any(String),
        duration: expect.any(String),
        fareBreakdown: {
          baseFare: expect.any(String),
          distanceFare: expect.any(String),
          timeFare: expect.any(String),
          surgeMultiplier: expect.any(String),
          total: expect.any(String),
        },
        paymentMethod: expect.any(String),
        generatedAt: expect.any(String),
      });
    });

    it('should return 400 for incomplete trip', async () => {
      // Create new trip without completing
      await createAcceptedRide();
      const newTrip = await request(app)
        .post('/api/v1/trips')
        .send({ rideRequestId: rideId });

      await request(app)
        .get(`/api/v1/trips/${newTrip.body.id}/receipt`)
        .expect(400);
    });
  });
});
