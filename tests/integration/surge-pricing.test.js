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
  await redis.flushdb();
});

describe('Surge Pricing Service', () => {
  describe('GET /api/v1/surge/:geoCell', () => {
    it('should return default surge (1.0x) when no data', async () => {
      const response = await request(app)
        .get('/api/v1/surge/h3_887339600ffffff')
        .expect(200);

      expect(response.body).toMatchObject({
        geoCell: 'h3_887339600ffffff',
        surgeMultiplier: 1.0,
        supplyCount: 0,
        demandCount: 0
      });
    });

    it('should return cached surge value', async () => {
      const geoCell = 'h3_887339600ffffff';
      await redis.hset(`surge:${geoCell}`,
        'multiplier', '1.8',
        'supply', '5',
        'demand', '15',
        'updatedAt', new Date().toISOString()
      );

      const response = await request(app)
        .get(`/api/v1/surge/${geoCell}`)
        .expect(200);

      expect(response.body.surgeMultiplier).toBe(1.8);
      expect(response.body.supplyCount).toBe(5);
      expect(response.body.demandCount).toBe(15);
    });
  });

  describe('POST /api/v1/surge/calculate', () => {
    it('should calculate surge based on supply/demand ratio', async () => {
      const response = await request(app)
        .post('/api/v1/surge/calculate')
        .send({
          geoCell: 'h3_887339600ffffff',
          region: 'bangalore',
          latitude: 12.9716,
          longitude: 77.5946
        })
        .expect(200);

      expect(response.body).toMatchObject({
        geoCell: expect.any(String),
        surgeMultiplier: expect.any(Number),
        supplyCount: expect.any(Number),
        demandCount: expect.any(Number),
        validUntil: expect.any(String)
      });
    });

    it('should increase surge when demand > supply', async () => {
      // Seed: many ride requests, few drivers
      const geoCell = 'h3_887339600ffffff';

      // Add few drivers
      await redis.geoadd('drivers:locations:bangalore', 77.5946, 12.9716, 'driver1');
      await redis.set('driver:driver1:presence', '1', 'EX', 30);
      await redis.hset('driver:driver1:meta', 'status', 'ONLINE');

      // Simulate high demand
      for (let i = 0; i < 10; i++) {
        await redis.incr(`demand:${geoCell}`);
      }
      await redis.expire(`demand:${geoCell}`, 300);

      const response = await request(app)
        .post('/api/v1/surge/calculate')
        .send({
          geoCell,
          region: 'bangalore',
          latitude: 12.9716,
          longitude: 77.5946
        })
        .expect(200);

      expect(response.body.surgeMultiplier).toBeGreaterThan(1.0);
    });

    it('should cap surge at maximum (3.0x)', async () => {
      const geoCell = 'h3_887339600ffffff';

      // Extreme demand scenario
      for (let i = 0; i < 100; i++) {
        await redis.incr(`demand:${geoCell}`);
      }
      await redis.expire(`demand:${geoCell}`, 300);

      const response = await request(app)
        .post('/api/v1/surge/calculate')
        .send({
          geoCell,
          region: 'bangalore',
          latitude: 12.9716,
          longitude: 77.5946
        })
        .expect(200);

      expect(response.body.surgeMultiplier).toBeLessThanOrEqual(3.0);
    });

    it('should floor surge at minimum (1.0x)', async () => {
      const geoCell = 'h3_887339600ffffff';

      // Many drivers, no demand
      for (let i = 0; i < 20; i++) {
        await redis.geoadd('drivers:locations:bangalore', 77.5946 + i * 0.001, 12.9716, `driver${i}`);
        await redis.set(`driver:driver${i}:presence`, '1', 'EX', 30);
        await redis.hset(`driver:driver${i}:meta`, 'status', 'ONLINE');
      }

      const response = await request(app)
        .post('/api/v1/surge/calculate')
        .send({
          geoCell,
          region: 'bangalore',
          latitude: 12.9716,
          longitude: 77.5946
        })
        .expect(200);

      expect(response.body.surgeMultiplier).toBe(1.0);
    });

    it('should cache calculated surge with TTL', async () => {
      const geoCell = 'h3_887339600ffffff';

      await request(app)
        .post('/api/v1/surge/calculate')
        .send({
          geoCell,
          region: 'bangalore',
          latitude: 12.9716,
          longitude: 77.5946
        })
        .expect(200);

      // Verify cache was set
      const cached = await redis.hgetall(`surge:${geoCell}`);
      expect(cached.multiplier).toBeDefined();

      const ttl = await redis.ttl(`surge:${geoCell}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60); // 60 second cache
    });
  });

  describe('GET /api/v1/surge/region/:region', () => {
    beforeEach(async () => {
      // Seed surge data for multiple cells
      const cells = [
        { cell: 'h3_887339600ffffff', multiplier: '1.5' },
        { cell: 'h3_887339601ffffff', multiplier: '2.0' },
        { cell: 'h3_887339602ffffff', multiplier: '1.0' }
      ];

      for (const { cell, multiplier } of cells) {
        await redis.hset(`surge:${cell}`,
          'multiplier', multiplier,
          'supply', '10',
          'demand', '15',
          'region', 'bangalore'
        );
        await redis.sadd('surge:cells:bangalore', cell);
      }
    });

    it('should return all surge zones for a region', async () => {
      const response = await request(app)
        .get('/api/v1/surge/region/bangalore')
        .expect(200);

      expect(response.body.region).toBe('bangalore');
      expect(response.body.zones).toBeInstanceOf(Array);
      expect(response.body.zones.length).toBe(3);
    });

    it('should filter zones by minimum surge', async () => {
      const response = await request(app)
        .get('/api/v1/surge/region/bangalore')
        .query({ minSurge: 1.5 })
        .expect(200);

      expect(response.body.zones.length).toBe(2);
      response.body.zones.forEach(zone => {
        expect(zone.surgeMultiplier).toBeGreaterThanOrEqual(1.5);
      });
    });
  });

  describe('POST /api/v1/surge/demand', () => {
    it('should increment demand counter for geo cell', async () => {
      const geoCell = 'h3_887339600ffffff';

      const response = await request(app)
        .post('/api/v1/surge/demand')
        .send({ geoCell, region: 'bangalore' })
        .expect(200);

      expect(response.body.demandCount).toBe(1);

      // Second increment
      const response2 = await request(app)
        .post('/api/v1/surge/demand')
        .send({ geoCell, region: 'bangalore' })
        .expect(200);

      expect(response2.body.demandCount).toBe(2);
    });

    it('should auto-expire demand after 5 minutes', async () => {
      const geoCell = 'h3_887339600ffffff';

      await request(app)
        .post('/api/v1/surge/demand')
        .send({ geoCell, region: 'bangalore' });

      const ttl = await redis.ttl(`demand:${geoCell}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
    });
  });

  describe('Surge Pricing Algorithm', () => {
    it('should calculate correct surge multiplier based on formula', async () => {
      // Formula: surge = min(3.0, max(1.0, demand / supply))
      // With smoothing: surge = 1.0 + (rawRatio - 1) * 0.5

      const testCases = [
        { supply: 10, demand: 10, expectedRange: [1.0, 1.0] },
        { supply: 10, demand: 20, expectedRange: [1.4, 1.6] },
        { supply: 5, demand: 30, expectedRange: [2.0, 2.5] },
        { supply: 1, demand: 100, expectedRange: [2.9, 3.0] }
      ];

      for (const tc of testCases) {
        const geoCell = `h3_test_${tc.supply}_${tc.demand}`;

        // Setup supply
        for (let i = 0; i < tc.supply; i++) {
          await redis.geoadd('drivers:locations:bangalore', 77.5946, 12.9716, `driver_${geoCell}_${i}`);
          await redis.set(`driver:driver_${geoCell}_${i}:presence`, '1', 'EX', 30);
          await redis.hset(`driver:driver_${geoCell}_${i}:meta`, 'status', 'ONLINE');
        }

        // Setup demand
        await redis.set(`demand:${geoCell}`, tc.demand.toString(), 'EX', 300);

        const response = await request(app)
          .post('/api/v1/surge/calculate')
          .send({
            geoCell,
            region: 'bangalore',
            latitude: 12.9716,
            longitude: 77.5946
          })
          .expect(200);

        expect(response.body.surgeMultiplier).toBeGreaterThanOrEqual(tc.expectedRange[0]);
        expect(response.body.surgeMultiplier).toBeLessThanOrEqual(tc.expectedRange[1]);
      }
    });
  });
});
