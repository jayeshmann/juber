const { getRedisClient } = require('../db/redis');
const config = require('../config');

/**
 * Sliding window rate limiter using Redis
 */
const rateLimiter = (options = {}) => {
  const {
    windowMs = config.RATE_LIMIT_WINDOW_MS,
    max = config.RATE_LIMIT_MAX_REQUESTS,
    keyGenerator = (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',
    message = 'Too many requests, please try again later'
  } = options;

  return async (req, res, next) => {
    const redis = getRedisClient();
    const key = `ratelimit:${keyGenerator(req)}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Remove old entries outside the window
      await redis.zremrangebyscore(key, 0, windowStart);

      // Count requests in current window
      const count = await redis.zcard(key);

      if (count >= max) {
        res.set('Retry-After', Math.ceil(windowMs / 1000));
        res.set('X-RateLimit-Limit', max);
        res.set('X-RateLimit-Remaining', 0);
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message,
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }

      // Add current request
      await redis.zadd(key, now, `${now}-${Math.random()}`);
      await redis.expire(key, Math.ceil(windowMs / 1000));

      // Set rate limit headers
      res.set('X-RateLimit-Limit', max);
      res.set('X-RateLimit-Remaining', max - count - 1);

      next();
    } catch (error) {
      console.error('Rate limiter error:', error);
      // Allow request if rate limiter fails
      next();
    }
  };
};

/**
 * Create endpoint-specific rate limiter
 */
const createEndpointLimiter = (endpoint, max, windowMs) => {
  return rateLimiter({
    max,
    windowMs,
    keyGenerator: (req) => `${endpoint}:${req.ip || 'unknown'}`
  });
};

module.exports = {
  rateLimiter,
  createEndpointLimiter
};
