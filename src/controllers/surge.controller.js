const surgePricingService = require('../services/surge-pricing.service');
const { calculateSurgeSchema, demandIncrementSchema } = require('../utils/validators');
const { asyncHandler } = require('../middleware/error-handler');

/**
 * Get surge for geo cell
 * GET /api/v1/surge/:geoCell
 */
const getSurgeForCell = asyncHandler(async (req, res) => {
  const { geoCell } = req.params;

  const surge = await surgePricingService.getSurgeForCell(geoCell);

  res.json(surge);
});

/**
 * Calculate surge for location
 * POST /api/v1/surge/calculate
 */
const calculateSurge = asyncHandler(async (req, res) => {
  const data = calculateSurgeSchema.parse(req.body);

  const result = await surgePricingService.calculateSurge(data);

  res.json(result);
});

/**
 * Get surge zones for region
 * GET /api/v1/surge/region/:region
 */
const getSurgeZonesForRegion = asyncHandler(async (req, res) => {
  const { region } = req.params;
  const minSurge = parseFloat(req.query.minSurge) || 1.0;

  const result = await surgePricingService.getSurgeZonesForRegion(region, minSurge);

  res.json(result);
});

/**
 * Increment demand counter
 * POST /api/v1/surge/demand
 */
const incrementDemand = asyncHandler(async (req, res) => {
  const data = demandIncrementSchema.parse(req.body);

  const result = await surgePricingService.incrementDemand(data.geoCell, data.region);

  res.json(result);
});

module.exports = {
  getSurgeForCell,
  calculateSurge,
  getSurgeZonesForRegion,
  incrementDemand
};
