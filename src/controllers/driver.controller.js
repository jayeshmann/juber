const driverLocationService = require('../services/driver-location.service');
const { locationUpdateSchema, nearbyDriversQuerySchema } = require('../utils/validators');
const { asyncHandler } = require('../middleware/error-handler');

/**
 * Update driver location
 * POST /api/v1/drivers/:driverId/location
 */
const updateLocation = asyncHandler(async (req, res) => {
  const { driverId } = req.params;
  const data = locationUpdateSchema.parse(req.body);

  const result = await driverLocationService.updateLocation(driverId, data);

  res.json(result);
});

/**
 * Get nearby drivers
 * GET /api/v1/drivers/nearby
 */
const getNearbyDrivers = asyncHandler(async (req, res) => {
  const params = nearbyDriversQuerySchema.parse(req.query);

  const result = await driverLocationService.findNearbyDrivers(params);

  res.json(result);
});

/**
 * Get driver location
 * GET /api/v1/drivers/:driverId/location
 */
const getDriverLocation = asyncHandler(async (req, res) => {
  const { driverId } = req.params;
  const region = req.query.region || 'bangalore';

  const location = await driverLocationService.getDriverLocation(driverId, region);

  if (!location) {
    return res.status(404).json({ error: 'Driver location not found' });
  }

  res.json(location);
});

/**
 * Update driver status
 * PATCH /api/v1/drivers/:driverId/status
 */
const updateDriverStatus = asyncHandler(async (req, res) => {
  const { driverId } = req.params;
  const { status } = req.body;

  if (!['ONLINE', 'OFFLINE', 'ON_TRIP'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const result = await driverLocationService.updateDriverStatus(driverId, status);

  res.json(result);
});

module.exports = {
  updateLocation,
  getNearbyDrivers,
  getDriverLocation,
  updateDriverStatus
};
