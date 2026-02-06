module.exports = {
  // Ride lifecycle events
  RIDE_REQUESTED: 'ride.requested',
  RIDE_MATCHED: 'ride.matched',
  RIDE_ACCEPTED: 'ride.accepted',
  RIDE_DECLINED: 'ride.declined',
  RIDE_CANCELLED: 'ride.cancelled',
  RIDE_EXPIRED: 'ride.expired',

  // Driver events
  DRIVER_LOCATION_UPDATED: 'driver.location.updated',
  DRIVER_STATUS_CHANGED: 'driver.status.changed',

  // Trip events
  TRIP_CREATED: 'trip.created',
  TRIP_STARTED: 'trip.started',
  TRIP_PAUSED: 'trip.paused',
  TRIP_RESUMED: 'trip.resumed',
  TRIP_COMPLETED: 'trip.completed',
  TRIP_CANCELLED: 'trip.cancelled',

  // Surge events
  SURGE_UPDATED: 'surge.updated',

  // Payment events
  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',

  // Notification events
  NOTIFICATION_SEND: 'notification.send'
};
