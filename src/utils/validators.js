const { z } = require('zod');

// Common schemas
const coordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

const uuidSchema = z.string().uuid();

// Driver Location schemas
const locationUpdateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timestamp: z.string().datetime().optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional()
});

const nearbyDriversQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.1).max(50).default(5),
  region: z.string().min(1),
  vehicleType: z.enum(['ECONOMY', 'PREMIUM', 'XL']).optional(),
  limit: z.coerce.number().min(1).max(50).default(20)
});

// Ride Request schemas
const rideRequestSchema = z.object({
  riderId: z.string().min(1),
  pickup: coordinateSchema,
  destination: coordinateSchema,
  tier: z.enum(['ECONOMY', 'PREMIUM', 'XL']),
  paymentMethod: z.enum(['CARD', 'WALLET', 'CASH'])
});

const driverResponseSchema = z.object({
  driverId: z.string().min(1),
  action: z.enum(['ACCEPT', 'DECLINE']),
  reason: z.string().optional()
});

// Trip schemas
const createTripSchema = z.object({
  rideRequestId: z.string().min(1)
});

const startTripSchema = z.object({
  startLat: z.number().min(-90).max(90),
  startLng: z.number().min(-180).max(180)
});

const endTripSchema = z.object({
  endLat: z.number().min(-90).max(90),
  endLng: z.number().min(-180).max(180),
  distanceKm: z.number().min(0),
  durationMinutes: z.number().min(0)
});

const cancelTripSchema = z.object({
  cancelledBy: z.enum(['RIDER', 'DRIVER', 'SYSTEM']),
  reason: z.string().optional()
});

// Surge schemas
const calculateSurgeSchema = z.object({
  geoCell: z.string().min(1),
  region: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

const demandIncrementSchema = z.object({
  geoCell: z.string().min(1),
  region: z.string().min(1)
});

module.exports = {
  coordinateSchema,
  uuidSchema,
  locationUpdateSchema,
  nearbyDriversQuerySchema,
  rideRequestSchema,
  driverResponseSchema,
  createTripSchema,
  startTripSchema,
  endTripSchema,
  cancelTripSchema,
  calculateSurgeSchema,
  demandIncrementSchema
};
