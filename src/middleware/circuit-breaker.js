const CircuitBreaker = require('opossum');
const config = require('../config');

const circuitBreakerDefaults = {
  timeout: config.CIRCUIT_BREAKER_TIMEOUT,
  errorThresholdPercentage: config.CIRCUIT_BREAKER_ERROR_THRESHOLD,
  resetTimeout: config.CIRCUIT_BREAKER_RESET_TIMEOUT,
  volumeThreshold: 5
};

const breakers = new Map();

/**
 * Get or create a circuit breaker for a service
 */
const getCircuitBreaker = (name, fn, options = {}) => {
  if (!breakers.has(name)) {
    const breaker = new CircuitBreaker(fn, {
      ...circuitBreakerDefaults,
      ...options,
      name
    });

    breaker.on('open', () => {
      console.log(`Circuit breaker '${name}' OPENED`);
    });

    breaker.on('halfOpen', () => {
      console.log(`Circuit breaker '${name}' HALF-OPEN`);
    });

    breaker.on('close', () => {
      console.log(`Circuit breaker '${name}' CLOSED`);
    });

    breaker.on('fallback', () => {
      console.log(`Circuit breaker '${name}' fallback executed`);
    });

    breakers.set(name, breaker);
  }

  return breakers.get(name);
};

/**
 * Execute function with circuit breaker protection
 */
const withCircuitBreaker = async (name, fn, fallback = null, options = {}) => {
  const breaker = getCircuitBreaker(name, fn, options);

  if (fallback) {
    breaker.fallback(fallback);
  }

  return breaker.fire();
};

/**
 * Get circuit breaker status
 */
const getCircuitBreakerStatus = (name) => {
  const breaker = breakers.get(name);
  if (!breaker) return null;

  return {
    name,
    state: breaker.status.state,
    stats: {
      fires: breaker.stats.fires,
      failures: breaker.stats.failures,
      successes: breaker.stats.successes,
      fallbacks: breaker.stats.fallbacks,
      timeouts: breaker.stats.timeouts
    }
  };
};

/**
 * Get all circuit breaker statuses
 */
const getAllCircuitBreakerStatuses = () => {
  const statuses = [];
  for (const [name] of breakers) {
    statuses.push(getCircuitBreakerStatus(name));
  }
  return statuses;
};

module.exports = {
  getCircuitBreaker,
  withCircuitBreaker,
  getCircuitBreakerStatus,
  getAllCircuitBreakerStatuses
};
