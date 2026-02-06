const express = require('express');
const tripController = require('../controllers/trip.controller');

const router = express.Router();

// Create trip
router.post('/', tripController.createTrip);

// Get trip
router.get('/:tripId', tripController.getTripById);

// Trip lifecycle
router.post('/:tripId/start', tripController.startTrip);
router.post('/:tripId/pause', tripController.pauseTrip);
router.post('/:tripId/resume', tripController.resumeTrip);
router.post('/:tripId/end', tripController.endTrip);
router.post('/:tripId/cancel', tripController.cancelTrip);

// Receipt
router.get('/:tripId/receipt', tripController.getTripReceipt);

module.exports = router;
