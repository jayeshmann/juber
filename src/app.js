const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { rateLimiter } = require('./middleware/rate-limiter');
const { getRedisClient } = require('./db/redis');
const { getPool } = require('./db/postgres');

/*
Location ingestion of driver -> using redis geo
Rider requesting a ride, immediately find a driver, timeouts, race condition
*/

const createApp = async () => {
  const app = express();

  // Security middleware
  app.use(helmet());
  app.use(cors());
  app.use(compression());

  // Body parsing
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging (simple)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (process.env.NODE_ENV !== 'test') {
        console.log(
          `${req.method} ${req.path} ${res.statusCode} ${duration}ms`,
        );
      }
    });
    next();
  });

  // Rate limiting (skip in test environment for faster tests)
  if (process.env.NODE_ENV !== 'test') {
    app.use('/api', rateLimiter());
  }

  // API routes
  app.use('/api/v1', routes);

  // Root route
  app.get('/', (req, res) => {
    res.json({
      name: 'Juber Ride-Hailing Platform',
      version: '1.0.0',
      docs: '/api/v1/health',
    });
  });

  // Metrics endpoint (for observability)
  app.get('/metrics', async (req, res) => {
    const {
      getAllCircuitBreakerStatuses,
    } = require('./middleware/circuit-breaker');

    res.json({
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      circuitBreakers: getAllCircuitBreakerStatuses(),
    });
  });

  // Error handlers
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Initialize connections
  try {
    const redis = getRedisClient();
    await redis.connect();
    console.log('Redis connected');
  } catch (err) {
    console.log('Redis connection deferred (will connect on first use)');
  }

  return app;
};

module.exports = { createApp };
