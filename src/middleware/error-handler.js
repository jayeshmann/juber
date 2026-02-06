const { z } = require('zod');

/**
 * Global error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('Error:', err);
  }

  // Zod validation errors
  if (
    err.name === 'ZodError' ||
    err instanceof z.ZodError ||
    (err.issues && Array.isArray(err.issues))
  ) {
    const issues = err.errors || err.issues || [];
    return res.status(400).json({
      error: 'Validation error',
      details: issues.map((e) => ({
        field: (e.path || []).join('.'),
        message: e.message,
      })),
    });
  }

  // Custom application errors
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  // Database errors
  if (err.code && typeof err.code === 'string' && err.code.startsWith('23')) {
    return res.status(409).json({
      error: 'Database constraint violation',
      code: err.code,
    });
  }

  // Default server error
  res.status(500).json({
    error: 'Internal server error',
    message:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'Something went wrong',
  });
};

/**
 * Not found handler
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`,
  });
};

/**
 * Async handler wrapper to catch async errors
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Create application error
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
};
