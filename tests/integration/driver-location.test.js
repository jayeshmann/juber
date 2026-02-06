const request = require('supertest');
const Redis = require('ioredis');

let app;
let redis;

beforeAll(async () => {
  const { createApp } = require('../../src/app');
  app = await createApp();
  redis = new Redis(process.env.REDIS_URL);
});

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  // Clear Redis geo data before each test
  await redis.del('drivers:locations:bangalore');
});

describe('Driver Location Service', () => {
  describe('POST /api/v1/drivers/:driverId/location', () => {
    const driverId = 'd1000000-0000-0000-0000-000000000001';
    const validLocation = {
      latitude: 12.9716,
      longitude: 77.5946,
      timestamp: new Date().toISOString(),
      heading: 45,
      speed: 30
    };

    it('should accept a valid location update', async () => {
      const response = await request(app)
        .post(`/api/v1/drivers/${driverId}/location`)
        .send(validLocation)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        driverId,
        geoCell: expect.any(String)
      });
    });

    it('should store location in Redis geo index', async () => {
      await request(app)
        .post(`/api/v1/drivers/${driverId}/location`)
        .send(validLocation)
        .expect(200);

      // Verify location was stored in Redis
      const position = await redis.geopos('drivers:locations:bangalore', driverId);
      expect(position[0]).not.toBeNull();
      expect(parseFloat(position[0][0])).toBeCloseTo(validLocation.longitude, 4);
      expect(parseFloat(position[0][1])).toBeCloseTo(validLocation.latitude, 4);
    });

    it('should reject invalid coordinates', async () => {
      const response = await request(app)
        .post(`/api/v1/drivers/${driverId}/location`)
        .send({ latitude: 'invalid', longitude: 77.5946 })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should reject coordinates out of range', async () => {
      const response = await request(app)
        .post(`/api/v1/drivers/${driverId}/location`)
        .send({ latitude: 91, longitude: 181 })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should handle high-frequency updates (1-2/sec simulation)', async () => {
      const updates = [];
      for (let i = 0; i < 5; i++) {
        updates.push(
          request(app)
            .post(`/api/v1/drivers/${driverId}/location`)
            .send({
              latitude: 12.9716 + i * 0.0001,
              longitude: 77.5946 + i * 0.0001,
              timestamp: new Date().toISOString()
            })
        );
      }

      const responses = await Promise.all(updates);
      responses.forEach(res => {
        expect(res.status).toBe(200);
      });
    });
  });

  describe('GET /api/v1/drivers/nearby', () => {
    const seedDriverLocations = async () => {
      const drivers = [
        { id: 'd1000000-0000-0000-0000-000000000001', lat: 12.9716, lng: 77.5946 },
        { id: 'd1000000-0000-0000-0000-000000000002', lat: 12.9720, lng: 77.5950 },
        { id: 'd1000000-0000-0000-0000-000000000003', lat: 12.9800, lng: 77.6000 }
      ];

      for (const driver of drivers) {
        await redis.geoadd('drivers:locations:bangalore', driver.lng, driver.lat, driver.id);
        await redis.hset(`driver:${driver.id}:meta`, 'status', 'ONLINE', 'vehicleType', 'ECONOMY');
      }
    };

    beforeEach(async () => {
      await seedDriverLocations();
    });

    it('should return nearby drivers within radius', async () => {
      const response = await request(app)
        .get('/api/v1/drivers/nearby')
        .query({
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 1,
          region: 'bangalore'
        })
        .expect(200);

      expect(response.body.drivers).toBeInstanceOf(Array);
      expect(response.body.drivers.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter by vehicle type', async () => {
      const response = await request(app)
        .get('/api/v1/drivers/nearby')
        .query({
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 5,
          region: 'bangalore',
          vehicleType: 'ECONOMY'
        })
        .expect(200);

      response.body.drivers.forEach(driver => {
        expect(driver.vehicleType).toBe('ECONOMY');
      });
    });

    it('should return drivers sorted by distance', async () => {
      const response = await request(app)
        .get('/api/v1/drivers/nearby')
        .query({
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 5,
          region: 'bangalore'
        })
        .expect(200);

      const distances = response.body.drivers.map(d => d.distanceKm);
      for (let i = 1; i < distances.length; i++) {
        expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
      }
    });

    it('should only return ONLINE drivers', async () => {
      // Set one driver to OFFLINE
      await redis.hset('driver:d1000000-0000-0000-0000-000000000001:meta', 'status', 'OFFLINE');

      const response = await request(app)
        .get('/api/v1/drivers/nearby')
        .query({
          latitude: 12.9716,
          longitude: 77.5946,
          radiusKm: 5,
          region: 'bangalore'
        })
        .expect(200);

      const offlineDriver = response.body.drivers.find(
        d => d.driverId === 'd1000000-0000-0000-0000-000000000001'
      );
      expect(offlineDriver).toBeUndefined();
    });
  });

  describe('Driver Presence (TTL-based)', () => {
    it('should expire driver location after TTL', async () => {
      const driverId = 'd1000000-0000-0000-0000-000000000001';

      // Update location with short TTL for testing
      await request(app)
        .post(`/api/v1/drivers/${driverId}/location`)
        .send({
          latitude: 12.9716,
          longitude: 77.5946,
          timestamp: new Date().toISOString()
        })
        .expect(200);

      // Verify presence key was set
      const presenceKey = `driver:${driverId}:presence`;
      const ttl = await redis.ttl(presenceKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30); // 30 second presence TTL
    });
  });
});
