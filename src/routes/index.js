const express = require('express');
const driverRoutes = require('./driver.routes');
const rideRoutes = require('./ride.routes');
const tripRoutes = require('./trip.routes');
const surgeRoutes = require('./surge.routes');

const router = express.Router();

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API routes
router.use('/drivers', driverRoutes);
router.use('/rides', rideRoutes);
router.use('/trips', tripRoutes);
router.use('/surge', surgeRoutes);

module.exports = router;
