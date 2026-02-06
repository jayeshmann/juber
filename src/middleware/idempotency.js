const { getRedisClient } = require('../db/redis');
const config = require('../config');
const crypto = require('crypto');

/**
 * Idempotency middleware
 * Ensures duplicate requests with same idempotency key return cached response
 */
const idempotencyMiddleware = (options = {}) => {
  const {
    headerName = 'Idempotency-Key',
    required = true,
    ttl = config.IDEMPOTENCY_TTL,
  } = options;

  return async (req, res, next) => {
    const idempotencyKey = req.headers[headerName.toLowerCase()];

    if (!idempotencyKey) {
      if (required) {
        return res.status(400).json({
          error: 'Missing idempotency key',
          message: `Header '${headerName}' is required for this endpoint`,
        });
      }
      return next();
    }

    const redis = getRedisClient();
    const cacheKey = `idempotency:${idempotencyKey}`;

    try {
      // Check if we have a cached response
      const cached = await redis.get(cacheKey);

      if (cached) {
        const { statusCode, body, requestHash } = JSON.parse(cached);

        // Verify request body matches (optional - prevents key reuse with different payloads)
        const currentHash = hashRequest(req);
        if (requestHash !== currentHash) {
          return res.status(422).json({
            error: 'Idempotency key conflict',
            message: 'This key was used with a different request payload',
          });
        }

        // Return cached response with indicator (200 for replayed responses)
        res.set('X-Idempotency-Replayed', 'true');
        return res.status(200).json(body);
      }

      // Store request hash for conflict detection
      req.idempotencyKey = idempotencyKey;
      req.idempotencyRequestHash = hashRequest(req);

      // Capture response for caching
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // Cache the response
        const cacheData = JSON.stringify({
          statusCode: res.statusCode,
          body,
          requestHash: req.idempotencyRequestHash,
          cachedAt: new Date().toISOString(),
        });

        redis.set(cacheKey, cacheData, 'EX', ttl).catch((err) => {
          console.error('Failed to cache idempotent response:', err);
        });

        return originalJson(body);
      };

      next();
    } catch (error) {
      console.error('Idempotency middleware error:', error);
      next();
    }
  };
};

/**
 * Hash request for conflict detection
 */
const hashRequest = (req) => {
  const content = JSON.stringify({
    method: req.method,
    path: req.path,
    body: req.body,
  });
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substring(0, 16);
};

module.exports = idempotencyMiddleware;
