const dispatchService = require('../services/dispatch.service');
const { rideRequestSchema, driverResponseSchema } = require('../utils/validators');
const { asyncHandler, AppError } = require('../middleware/error-handler');

/**
 * Create ride request
 * POST /api/v1/rides
 */
const createRideRequest = asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'Missing Idempotency-Key header',
      message: 'All ride requests must include an Idempotency-Key header'
    });
  }

  const data = rideRequestSchema.parse(req.body);

  const result = await dispatchService.createRideRequest({
    ...data,
    idempotencyKey
  });

  res.status(201).json(result);
});

/**
 * Get ride details
 * GET /api/v1/rides/:rideId
 */
const getRideDetails = asyncHandler(async (req, res) => {
  const { rideId } = req.params;

  const ride = await dispatchService.getRideDetails(rideId);

  if (!ride) {
    return res.status(404).json({ error: 'Ride not found' });
  }

  res.json(ride);
});

/**
 * Handle driver response to ride offer
 * POST /api/v1/rides/:rideId/driver-response
 */
const handleDriverResponse = asyncHandler(async (req, res) => {
  const { rideId } = req.params;
  const data = driverResponseSchema.parse(req.body);

  const result = await dispatchService.handleDriverResponse(rideId, data);

  res.json(result);
});

/**
 * Check for driver timeout
 * POST /api/v1/rides/:rideId/check-timeout
 */
const checkTimeout = asyncHandler(async (req, res) => {
  const { rideId } = req.params;

  const result = await dispatchService.checkTimeout(rideId);

  res.json(result);
});

/**
 * Cancel ride
 * POST /api/v1/rides/:rideId/cancel
 */
const cancelRide = asyncHandler(async (req, res) => {
  const { rideId } = req.params;
  const { reason } = req.body;

  // Update ride status
  const { query } = require('../db/postgres');
  await query(
    `UPDATE ride_requests SET status = 'CANCELLED' WHERE id = $1`,
    [rideId]
  );

  res.json({ status: 'CANCELLED', rideId, reason });
});

module.exports = {
  createRideRequest,
  getRideDetails,
  handleDriverResponse,
  checkTimeout,
  cancelRide
};
