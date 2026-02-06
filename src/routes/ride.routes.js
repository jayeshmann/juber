const express = require('express');
const rideController = require('../controllers/ride.controller');
const idempotencyMiddleware = require('../middleware/idempotency');

const router = express.Router();

// Create ride request (requires idempotency)
router.post('/', idempotencyMiddleware({ required: true }), rideController.createRideRequest);

// Get ride details
router.get('/:rideId', rideController.getRideDetails);

// Driver response to ride offer
router.post('/:rideId/driver-response', rideController.handleDriverResponse);

// Check for driver timeout
router.post('/:rideId/check-timeout', rideController.checkTimeout);

// Cancel ride
router.post('/:rideId/cancel', rideController.cancelRide);

module.exports = router;
