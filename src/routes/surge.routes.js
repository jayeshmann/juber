const express = require('express');
const surgeController = require('../controllers/surge.controller');

const router = express.Router();

// Get surge for geo cell
router.get('/:geoCell', surgeController.getSurgeForCell);

// Calculate surge for location
router.post('/calculate', surgeController.calculateSurge);

// Get surge zones for region
router.get('/region/:region', surgeController.getSurgeZonesForRegion);

// Increment demand counter
router.post('/demand', surgeController.incrementDemand);

module.exports = router;
