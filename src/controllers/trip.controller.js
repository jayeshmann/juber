const tripService = require('../services/trip.service');
const {
  createTripSchema,
  startTripSchema,
  endTripSchema,
  cancelTripSchema,
} = require('../utils/validators');
const { asyncHandler, AppError } = require('../middleware/error-handler');

/**
 * Create trip from accepted ride
 * POST /api/v1/trips
 */
const createTrip = asyncHandler(async (req, res) => {
  const data = createTripSchema.parse(req.body);

  try {
    const trip = await tripService.createTrip(data.rideRequestId);
    res.status(201).json(trip);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Get trip by ID
 * GET /api/v1/trips/:tripId
 */
const getTripById = asyncHandler(async (req, res) => {
  const { tripId } = req.params;

  const trip = await tripService.getTripById(tripId);

  if (!trip) {
    return res.status(404).json({ error: 'Trip not found' });
  }

  res.json(trip);
});

/**
 * Start trip
 * POST /api/v1/trips/:tripId/start
 */
const startTrip = asyncHandler(async (req, res) => {
  const { tripId } = req.params;
  const data = startTripSchema.parse(req.body);

  try {
    const result = await tripService.startTrip(tripId, data);
    res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Pause trip
 * POST /api/v1/trips/:tripId/pause
 */
const pauseTrip = asyncHandler(async (req, res) => {
  const { tripId } = req.params;
  const { reason } = req.body;

  try {
    const result = await tripService.pauseTrip(tripId, reason);
    res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Resume trip
 * POST /api/v1/trips/:tripId/resume
 */
const resumeTrip = asyncHandler(async (req, res) => {
  const { tripId } = req.params;

  try {
    const result = await tripService.resumeTrip(tripId);
    res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * End trip
 * POST /api/v1/trips/:tripId/end
 */
const endTrip = asyncHandler(async (req, res) => {
  const { tripId } = req.params;
  const data = endTripSchema.parse(req.body);

  try {
    const result = await tripService.endTrip(tripId, data);
    res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Cancel trip
 * POST /api/v1/trips/:tripId/cancel
 */
const cancelTrip = asyncHandler(async (req, res) => {
  const { tripId } = req.params;
  const data = cancelTripSchema.parse(req.body);

  try {
    const result = await tripService.cancelTrip(tripId, data);
    res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Get trip receipt
 * GET /api/v1/trips/:tripId/receipt
 */
const getTripReceipt = asyncHandler(async (req, res) => {
  const { tripId } = req.params;

  try {
    const receipt = await tripService.generateReceipt(tripId);
    res.json(receipt);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = {
  createTrip,
  getTripById,
  startTrip,
  pauseTrip,
  resumeTrip,
  endTrip,
  cancelTrip,
  getTripReceipt,
};
