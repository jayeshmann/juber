module.exports = {
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://juber:juber_secret@localhost:5433/juber_db',

  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6380',

  // Kafka
  KAFKA_BROKERS: process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9194'],
  KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID || 'juber-platform',

  // Driver Location
  DRIVER_PRESENCE_TTL: parseInt(process.env.DRIVER_PRESENCE_TTL) || 30, // seconds
  DEFAULT_SEARCH_RADIUS_KM: parseFloat(process.env.DEFAULT_SEARCH_RADIUS_KM) || 5,
  DEFAULT_REGION: process.env.DEFAULT_REGION || 'bangalore',

  // Dispatch
  DRIVER_RESPONSE_TIMEOUT: parseInt(process.env.DRIVER_RESPONSE_TIMEOUT) || 15000, // ms
  MAX_MATCH_ATTEMPTS: parseInt(process.env.MAX_MATCH_ATTEMPTS) || 5,

  // Surge Pricing
  SURGE_CACHE_TTL: parseInt(process.env.SURGE_CACHE_TTL) || 60, // seconds
  SURGE_MIN: parseFloat(process.env.SURGE_MIN) || 1.0,
  SURGE_MAX: parseFloat(process.env.SURGE_MAX) || 3.0,
  DEMAND_COUNTER_TTL: parseInt(process.env.DEMAND_COUNTER_TTL) || 300, // seconds

  // Fare Calculation
  FARE_BASE: parseFloat(process.env.FARE_BASE) || 50,
  FARE_PER_KM: parseFloat(process.env.FARE_PER_KM) || 12,
  FARE_PER_MINUTE: parseFloat(process.env.FARE_PER_MINUTE) || 2,
  CANCELLATION_FEE: parseFloat(process.env.CANCELLATION_FEE) || 50,

  // Idempotency
  IDEMPOTENCY_TTL: parseInt(process.env.IDEMPOTENCY_TTL) || 86400, // 24 hours

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,

  // Circuit Breaker
  CIRCUIT_BREAKER_TIMEOUT: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT) || 3000,
  CIRCUIT_BREAKER_ERROR_THRESHOLD: parseInt(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD) || 50,
  CIRCUIT_BREAKER_RESET_TIMEOUT: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT) || 30000
};
