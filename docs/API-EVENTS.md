# API & Event Documentation

## 1. REST API Reference

### 1.1 Driver Location APIs

#### Update Driver Location

```http
POST /api/v1/drivers/:driverId/location
Content-Type: application/json

Request:
{
  "latitude": 12.9716,      // Required: -90 to 90
  "longitude": 77.5946,     // Required: -180 to 180
  "timestamp": "ISO8601",   // Optional: defaults to now
  "heading": 45,            // Optional: 0-360 degrees
  "speed": 25.5             // Optional: km/h
}

Response 200:
{
  "success": true,
  "driverId": "uuid",
  "geoCell": "h3_8129717...",
  "region": "bangalore"
}
```

#### Find Nearby Drivers

```http
GET /api/v1/drivers/nearby?latitude=12.97&longitude=77.59&radiusKm=5&vehicleType=ECONOMY&region=bangalore

Response 200:
{
  "drivers": [
    {
      "driverId": "uuid",
      "distanceKm": 0.5,
      "latitude": 12.9716,
      "longitude": 77.5946,
      "vehicleType": "ECONOMY",
      "status": "ONLINE",
      "eta": 3
    }
  ],
  "count": 1
}
```

---

### 1.2 Ride APIs

#### Create Ride Request

```http
POST /api/v1/rides
Idempotency-Key: {uuid}  // Required
Content-Type: application/json

Request:
{
  "riderId": "uuid",                    // Required
  "pickup": { "lat": 12.97, "lng": 77.59 },
  "destination": { "lat": 12.98, "lng": 77.61 },
  "tier": "ECONOMY | PREMIUM | XL",     // Required
  "paymentMethod": "CARD | WALLET | CASH"
}

Response 201:
{
  "id": "uuid",
  "status": "MATCHING",
  "riderId": "uuid",
  "pickup": { "lat": 12.97, "lng": 77.59 },
  "destination": { "lat": 12.98, "lng": 77.61 },
  "tier": "ECONOMY",
  "surgeMultiplier": 1.5,
  "estimatedFare": 253.26,
  "matchedDriver": {
    "driverId": "uuid",
    "distanceKm": 0.5,
    "eta": 3
  },
  "matchAttempts": 1
}
```

#### Driver Response

```http
POST /api/v1/rides/:rideId/driver-response
Content-Type: application/json

Request:
{
  "driverId": "uuid",
  "action": "ACCEPT | DECLINE"
}

Response 200:
{
  "rideId": "uuid",
  "status": "ACCEPTED",
  "message": "Ride accepted successfully"
}
```

---

### 1.3 Trip APIs

#### Create Trip

```http
POST /api/v1/trips
Content-Type: application/json

Request:
{
  "rideRequestId": "uuid"
}

Response 201:
{
  "id": "uuid",
  "rideRequestId": "uuid",
  "status": "PENDING",
  "driverId": "uuid",
  "riderId": "uuid"
}
```

#### Start Trip

```http
POST /api/v1/trips/:tripId/start
Content-Type: application/json

Request:
{
  "startLat": 12.9716,
  "startLng": 77.5946
}

Response 200:
{
  "tripId": "uuid",
  "status": "STARTED",
  "startTime": "ISO8601"
}
```

#### End Trip

```http
POST /api/v1/trips/:tripId/end
Content-Type: application/json

Request:
{
  "endLat": 12.98,
  "endLng": 77.61,
  "distanceKm": 5.2,
  "durationMinutes": 18
}

Response 200:
{
  "tripId": "uuid",
  "status": "COMPLETED",
  "fare": {
    "baseFare": 50,
    "distanceFare": 62.40,
    "timeFare": 36,
    "surgeMultiplier": 1.5,
    "total": 222.60
  }
}
```

#### Get Receipt

```http
GET /api/v1/trips/:tripId/receipt

Response 200:
{
  "tripId": "uuid",
  "riderName": "John Doe",
  "driverName": "Jane Smith",
  "driverLicensePlate": "KA01AB1234",
  "pickup": { "lat": 12.97, "lng": 77.59 },
  "destination": { "lat": 12.98, "lng": 77.61 },
  "distance": "5.200 km",
  "duration": "18 min",
  "fareBreakdown": {
    "baseFare": "₹50.00",
    "distanceFare": "₹62.40",
    "timeFare": "₹36.00",
    "surgeMultiplier": "1.50x",
    "total": "₹222.60"
  },
  "paymentMethod": "CARD",
  "startTime": "ISO8601",
  "endTime": "ISO8601"
}
```

---

### 1.4 Surge APIs

#### Get Surge for Location

```http
POST /api/v1/surge/calculate
Content-Type: application/json

Request:
{
  "latitude": 12.9716,
  "longitude": 77.5946,
  "region": "bangalore"
}

Response 200:
{
  "geoCell": "h3_8129717...",
  "region": "bangalore",
  "multiplier": 1.5,
  "demand": 45,
  "supply": 30,
  "cachedAt": "ISO8601"
}
```

---

## 2. Error Responses

### Standard Error Format

```json
{
  "error": "Error type",
  "message": "Human-readable message",
  "code": "ERROR_CODE",
  "details": {} // Optional
}
```

### Error Codes

| HTTP Status | Code                   | Description                 |
| ----------- | ---------------------- | --------------------------- |
| 400         | `VALIDATION_ERROR`     | Invalid request payload     |
| 409         | `IDEMPOTENCY_CONFLICT` | Same key, different payload |
| 404         | `NOT_FOUND`            | Resource not found          |
| 429         | `RATE_LIMITED`         | Too many requests           |
| 500         | `INTERNAL_ERROR`       | Server error                |
| 503         | `SERVICE_UNAVAILABLE`  | Service overloaded          |

---

## 3. Kafka Event Catalog

### 3.1 Ride Events

#### ride.requested

```json
{
  "eventId": "uuid",
  "eventType": "ride.requested",
  "timestamp": "ISO8601",
  "data": {
    "rideId": "uuid",
    "riderId": "uuid",
    "pickup": { "lat": 12.97, "lng": 77.59 },
    "destination": { "lat": 12.98, "lng": 77.61 },
    "tier": "ECONOMY",
    "surgeMultiplier": 1.5,
    "estimatedFare": 253.26,
    "region": "bangalore"
  }
}
```

#### ride.matched

```json
{
  "eventId": "uuid",
  "eventType": "ride.matched",
  "timestamp": "ISO8601",
  "data": {
    "rideId": "uuid",
    "riderId": "uuid",
    "driverId": "uuid",
    "distanceKm": 0.5,
    "eta": 3,
    "offerExpiresAt": "ISO8601"
  }
}
```

#### ride.accepted / ride.declined

```json
{
  "eventId": "uuid",
  "eventType": "ride.accepted",
  "timestamp": "ISO8601",
  "data": {
    "rideId": "uuid",
    "driverId": "uuid",
    "riderId": "uuid"
  }
}
```

---

### 3.2 Trip Events

#### trip.created

```json
{
  "eventId": "uuid",
  "eventType": "trip.created",
  "timestamp": "ISO8601",
  "data": {
    "tripId": "uuid",
    "rideRequestId": "uuid",
    "driverId": "uuid",
    "riderId": "uuid",
    "surgeMultiplier": 1.5
  }
}
```

#### trip.started

```json
{
  "eventId": "uuid",
  "eventType": "trip.started",
  "timestamp": "ISO8601",
  "data": {
    "tripId": "uuid",
    "driverId": "uuid",
    "startLocation": { "lat": 12.97, "lng": 77.59 }
  }
}
```

#### trip.completed

```json
{
  "eventId": "uuid",
  "eventType": "trip.completed",
  "timestamp": "ISO8601",
  "data": {
    "tripId": "uuid",
    "driverId": "uuid",
    "riderId": "uuid",
    "distance": 5.2,
    "duration": 18,
    "fare": 222.6,
    "paymentMethod": "CARD"
  }
}
```

---

### 3.3 Driver Events

#### driver.location.updated

```json
{
  "eventId": "uuid",
  "eventType": "driver.location.updated",
  "timestamp": "ISO8601",
  "data": {
    "driverId": "uuid",
    "latitude": 12.9716,
    "longitude": 77.5946,
    "geoCell": "h3_8129717...",
    "region": "bangalore"
  }
}
```

#### driver.status.changed

```json
{
  "eventId": "uuid",
  "eventType": "driver.status.changed",
  "timestamp": "ISO8601",
  "data": {
    "driverId": "uuid",
    "previousStatus": "ONLINE",
    "newStatus": "ON_TRIP"
  }
}
```

---

### 3.4 Surge Events

#### surge.updated

```json
{
  "eventId": "uuid",
  "eventType": "surge.updated",
  "timestamp": "ISO8601",
  "data": {
    "geoCell": "h3_8129717...",
    "region": "bangalore",
    "previousMultiplier": 1.0,
    "newMultiplier": 1.5,
    "demand": 45,
    "supply": 30
  }
}
```

---

## 4. Topic Configuration

| Topic                     | Partitions | Retention | Key      |
| ------------------------- | ---------- | --------- | -------- |
| `ride.requested`          | 12         | 7 days    | rideId   |
| `ride.matched`            | 12         | 7 days    | rideId   |
| `ride.accepted`           | 12         | 7 days    | rideId   |
| `ride.declined`           | 12         | 7 days    | rideId   |
| `trip.created`            | 12         | 7 days    | tripId   |
| `trip.started`            | 12         | 7 days    | tripId   |
| `trip.completed`          | 12         | 7 days    | tripId   |
| `driver.location.updated` | 24         | 1 day     | driverId |
| `driver.status.changed`   | 12         | 7 days    | driverId |
| `surge.updated`           | 6          | 1 day     | geoCell  |
