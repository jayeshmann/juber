/**
 * Test Setup
 *
 * Uses the existing Docker Compose services for testing.
 * Run `npm run docker:up` before running tests.
 */

const config = require('../src/config');

// Set test environment variables to use Docker Compose services
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = config.DATABASE_URL;
process.env.REDIS_URL = config.REDIS_URL;
process.env.KAFKA_BROKERS = config.KAFKA_BROKERS.join(',');

let redisClient;
let pgPool;

beforeAll(async () => {
  // Import clients after env vars are set
  const { getRedisClient } = require('../src/db/redis');
  const { getPool } = require('../src/db/postgres');

  redisClient = getRedisClient();
  pgPool = getPool();

  // Wait for connections
  try {
    await redisClient.ping();
    console.log('Redis connected for tests');
  } catch (err) {
    console.warn('Redis not available, tests may fail:', err.message);
  }

  try {
    const client = await pgPool.connect();
    client.release();
    console.log('PostgreSQL connected for tests');
  } catch (err) {
    console.warn('PostgreSQL not available, tests may fail:', err.message);
  }
});

afterAll(async () => {
  // Close connections
  const { closeRedisConnection } = require('../src/db/redis');
  const { closePool } = require('../src/db/postgres');
  const { disconnectProducer } = require('../src/events/kafka-producer');

  try {
    await closeRedisConnection();
  } catch (err) {
    // Ignore
  }

  try {
    await closePool();
  } catch (err) {
    // Ignore
  }

  try {
    await disconnectProducer();
  } catch (err) {
    // Ignore
  }
});

// Clean up Redis between tests
beforeEach(async () => {
  if (redisClient && redisClient.status === 'ready') {
    // Clear test keys but preserve structure
    const keys = await redisClient.keys('driver:*');
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
    const geoKeys = await redisClient.keys('drivers:locations:*');
    if (geoKeys.length > 0) {
      await redisClient.del(...geoKeys);
    }
  }
});
