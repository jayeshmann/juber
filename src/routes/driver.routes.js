const express = require('express');
const driverController = require('../controllers/driver.controller');

const router = express.Router();

// Driver location updates (high frequency - 1-2/sec per driver)
router.post('/:driverId/location', driverController.updateLocation);
router.get('/:driverId/location', driverController.getDriverLocation);

// Nearby drivers search
router.get('/nearby', driverController.getNearbyDrivers);

// Driver status
router.patch('/:driverId/status', driverController.updateDriverStatus);

module.exports = router;
