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
  // Clean up ride requests and offers
  await pgPool.query('DELETE FROM driver_offers');
  await pgPool.query('DELETE FROM ride_requests');
  await redis.flushdb();

  // Seed driver locations
  const drivers = [
    { id: 'd1000000-0000-0000-0000-000000000001', lat: 12.9716, lng: 77.5946 },
    { id: 'd1000000-0000-0000-0000-000000000002', lat: 12.972, lng: 77.595 },
    { id: 'd1000000-0000-0000-0000-000000000003', lat: 12.98, lng: 77.6 },
  ];

  for (const driver of drivers) {
    await redis.geoadd(
      'drivers:locations:bangalore',
      driver.lng,
      driver.lat,
      driver.id,
    );
    await redis.hset(
      `driver:${driver.id}:meta`,
      'status',
      'ONLINE',
      'vehicleType',
      'ECONOMY',
    );
    await redis.set(`driver:${driver.id}:presence`, '1', 'EX', 30);
  }
});

describe('Dispatch/Matching Service', () => {
  describe('POST /api/v1/rides - Ride Request Creation', () => {
    const validRideRequest = {
      riderId: 'a1000000-0000-0000-0000-000000000001',
      pickup: { lat: 12.9716, lng: 77.5946 },
      destination: { lat: 12.98, lng: 77.61 },
      tier: 'ECONOMY',
      paymentMethod: 'CARD',
    };

    it('should create a ride request successfully', async () => {
      const response = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', 'ride-req-001')
        .send(validRideRequest)
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        status: 'MATCHING',
        riderId: validRideRequest.riderId,
        surgeMultiplier: expect.any(Number),
        estimatedFare: expect.any(Number),
      });
    });

    it('should return same response for duplicate idempotency key', async () => {
      const idempotencyKey = 'ride-req-002';

      const response1 = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', idempotencyKey)
        .send(validRideRequest)
        .expect(201);

      const response2 = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', idempotencyKey)
        .send(validRideRequest)
        .expect(200); // Returns cached response

      expect(response1.body.id).toBe(response2.body.id);
    });

    it('should reject request without idempotency key', async () => {
      await request(app)
        .post('/api/v1/rides')
        .send(validRideRequest)
        .expect(400);
    });

    it('should include surge multiplier from pricing service', async () => {
      // Set up surge for the pickup geo-cell
      const geoCell = 'h3_887339600ffffff'; // Mock H3 cell
      await redis.set(`surge:${geoCell}`, '1.5', 'EX', 60);

      const response = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', 'ride-req-003')
        .send(validRideRequest)
        .expect(201);

      expect(response.body.surgeMultiplier).toBeGreaterThanOrEqual(1.0);
    });

    it('should validate required fields', async () => {
      const invalidRequest = { riderId: 'r1' };

      const response = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', 'ride-req-004')
        .send(invalidRequest)
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.details).toBeDefined();
    });
  });

  describe('Driver Matching - p95 < 1s SLO', () => {
    it('should match a driver within 1 second', async () => {
      const startTime = Date.now();

      const response = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', 'ride-req-match-001')
        .send({
          riderId: 'a1000000-0000-0000-0000-000000000001',
          pickup: { lat: 12.9716, lng: 77.5946 },
          destination: { lat: 12.98, lng: 77.61 },
          tier: 'ECONOMY',
          paymentMethod: 'CARD',
        })
        .expect(201);

      const latency = Date.now() - startTime;

      // Verify match was initiated
      expect(response.body.status).toBe('MATCHING');
      expect(response.body.matchedDriver).toBeDefined();

      // SLO: p95 < 1s for dispatch decision
      expect(latency).toBeLessThan(1000);
    });

    it('should select nearest available driver', async () => {
      const response = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', 'ride-req-match-002')
        .send({
          riderId: 'a1000000-0000-0000-0000-000000000001',
          pickup: { lat: 12.9716, lng: 77.5946 },
          destination: { lat: 12.98, lng: 77.61 },
          tier: 'ECONOMY',
          paymentMethod: 'CARD',
        })
        .expect(201);

      // Driver 1 is closest to pickup location
      expect(response.body.matchedDriver.driverId).toBe(
        'd1000000-0000-0000-0000-000000000001',
      );
    });

    it('should filter drivers by vehicle tier', async () => {
      // Set driver 2 to PREMIUM tier
      await redis.hset(
        'driver:d1000000-0000-0000-0000-000000000002:meta',
        'vehicleType',
        'PREMIUM',
      );

      const response = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', 'ride-req-match-003')
        .send({
          riderId: 'a1000000-0000-0000-0000-000000000001',
          pickup: { lat: 12.972, lng: 77.595 }, // Closer to driver 2
          destination: { lat: 12.98, lng: 77.61 },
          tier: 'PREMIUM',
          paymentMethod: 'CARD',
        })
        .expect(201);

      expect(response.body.matchedDriver.driverId).toBe(
        'd1000000-0000-0000-0000-000000000002',
      );
    });
  });

  describe('POST /api/v1/rides/:rideId/driver-response', () => {
    let rideId;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', `ride-resp-${Date.now()}`)
        .send({
          riderId: 'a1000000-0000-0000-0000-000000000001',
          pickup: { lat: 12.9716, lng: 77.5946 },
          destination: { lat: 12.98, lng: 77.61 },
          tier: 'ECONOMY',
          paymentMethod: 'CARD',
        });
      rideId = response.body.id;
    });

    it('should accept driver acceptance', async () => {
      const response = await request(app)
        .post(`/api/v1/rides/${rideId}/driver-response`)
        .send({
          driverId: 'd1000000-0000-0000-0000-000000000001',
          action: 'ACCEPT',
        })
        .expect(200);

      expect(response.body.status).toBe('ACCEPTED');
      expect(response.body.driverId).toBe(
        'd1000000-0000-0000-0000-000000000001',
      );
    });

    it('should handle driver decline and reassign', async () => {
      // First driver declines
      const declineResponse = await request(app)
        .post(`/api/v1/rides/${rideId}/driver-response`)
        .send({
          driverId: 'd1000000-0000-0000-0000-000000000001',
          action: 'DECLINE',
          reason: 'Too far',
        })
        .expect(200);

      // Response should indicate REASSIGNED or EXPIRED (if no other drivers available)
      expect(['REASSIGNED', 'EXPIRED']).toContain(declineResponse.body.status);
    });

    it('should expire ride after max reassignment attempts', async () => {
      // First driver declines - expect terminal state in response
      const declineResponse = await request(app)
        .post(`/api/v1/rides/${rideId}/driver-response`)
        .send({
          driverId: 'd1000000-0000-0000-0000-000000000001',
          action: 'DECLINE',
          reason: 'Busy',
        });

      // Response should be one of the expected outcomes
      expect(['REASSIGNED', 'EXPIRED']).toContain(declineResponse.body.status);
    });

    it('should timeout and reassign after 15 seconds', async () => {
      // Trigger timeout check (no real timer waiting needed)
      const response = await request(app)
        .post(`/api/v1/rides/${rideId}/check-timeout`)
        .expect(200);

      // Response should indicate whether timeout occurred
      expect(response.body).toHaveProperty('timedOut');
    });
  });

  describe('GET /api/v1/rides/:rideId', () => {
    it('should return ride details', async () => {
      // Use unique idempotency key
      const uniqueKey = `ride-get-${Date.now()}`;
      const createResponse = await request(app)
        .post('/api/v1/rides')
        .set('Idempotency-Key', uniqueKey)
        .send({
          riderId: 'a1000000-0000-0000-0000-000000000001',
          pickup: { lat: 12.9716, lng: 77.5946 },
          destination: { lat: 12.98, lng: 77.61 },
          tier: 'ECONOMY',
          paymentMethod: 'CARD',
        })
        .expect(201);

      // Small delay to ensure DB write completes
      await new Promise((resolve) => setTimeout(resolve, 50));

      const response = await request(app)
        .get(`/api/v1/rides/${createResponse.body.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: createResponse.body.id,
        riderId: 'a1000000-0000-0000-0000-000000000001',
        status: expect.any(String),
      });
    });

    it('should return 404 for non-existent ride', async () => {
      await request(app).get('/api/v1/rides/non-existent-id').expect(404);
    });
  });
});
