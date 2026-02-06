# Low-Level Design (LLD) - Dispatch/Matching Service

## 1. Overview

The Dispatch Service is the core matching engine responsible for:

- Receiving ride requests and finding optimal drivers
- Managing driver offers with timeouts
- Handling acceptance, decline, and reassignment flows
- Ensuring p95 matching latency < 1 second

---

## 2. State Diagrams

### 2.1 Ride Request State Machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: Ride created
    PENDING --> MATCHING: Start matching
    MATCHING --> DRIVER_OFFERED: Driver found
    MATCHING --> NO_DRIVERS: No drivers available
    DRIVER_OFFERED --> ACCEPTED: Driver accepts
    DRIVER_OFFERED --> DECLINED: Driver declines
    DRIVER_OFFERED --> EXPIRED: 15s timeout
    DECLINED --> MATCHING: Try next driver
    EXPIRED --> MATCHING: Try next driver
    MATCHING --> FAILED: Max attempts reached
    ACCEPTED --> [*]: Ready for trip
    NO_DRIVERS --> [*]: Terminal
    FAILED --> [*]: Terminal
```

### 2.2 Driver Offer State Machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: Offer created
    PENDING --> ACCEPTED: Driver accepts (< 15s)
    PENDING --> DECLINED: Driver declines
    PENDING --> EXPIRED: Timeout (15s)
    ACCEPTED --> [*]: Offer completed
    DECLINED --> [*]: Offer terminated
    EXPIRED --> [*]: Offer terminated
```

### 2.3 Trip State Machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: Trip created from accepted ride
    PENDING --> STARTED: Driver starts trip
    STARTED --> PAUSED: Temporary stop
    PAUSED --> STARTED: Resume trip
    STARTED --> COMPLETED: Reach destination
    PENDING --> CANCELLED: Rider/Driver cancels
    STARTED --> CANCELLED: Mid-trip cancellation
    COMPLETED --> [*]: Fare calculated
    CANCELLED --> [*]: Cancellation fee applied
```

---

## 3. Core Algorithms

### 3.1 Driver Scoring Algorithm

```javascript
function scoreDriver(driver, rideRequest) {
  const { distanceKm, vehicleType, rating, acceptanceRate } = driver;
  const { tier } = rideRequest;

  let score = 100;

  // Distance score (closer is better) - 40% weight
  score -= distanceKm * 8; // -8 points per km

  // Vehicle match bonus - 30% weight
  if (vehicleType === tier) {
    score += 30;
  } else if (canUpgrade(vehicleType, tier)) {
    score += 15; // Partial bonus for upgrade
  }

  // Rating bonus - 20% weight
  score += (rating - 4.0) * 20; // +/- based on 4.0 baseline

  // Acceptance rate bonus - 10% weight
  score += acceptanceRate * 10;

  return Math.max(0, score);
}
```

### 3.2 Matching Flow

```mermaid
flowchart TD
    A[Receive Ride Request] --> B[Validate Request]
    B --> C[Check Idempotency]
    C -->|Duplicate| D[Return Cached Response]
    C -->|New| E[Get Surge Multiplier]
    E --> F[Find Nearby Drivers]
    F --> G{Drivers Found?}
    G -->|No| H[Set NO_DRIVERS]
    G -->|Yes| I[Score & Rank Drivers]
    I --> J[Select Best Driver]
    J --> K[Create Driver Offer]
    K --> L[Set 15s Expiry in Redis]
    L --> M[Publish ride.matched Event]
    M --> N[Return Match Result]
```

---

## 4. Data Model

### 4.1 Entity Relationship Diagram

```mermaid
erDiagram
    DRIVERS ||--o{ RIDE_REQUESTS : receives
    RIDERS ||--o{ RIDE_REQUESTS : creates
    RIDE_REQUESTS ||--o{ DRIVER_OFFERS : has
    RIDE_REQUESTS ||--o| TRIPS : becomes
    TRIPS ||--o{ PAYMENTS : has

    DRIVERS {
        uuid id PK
        string name
        string phone
        enum vehicle_type
        string license_plate
        enum status
        string region
        timestamp created_at
    }

    RIDERS {
        uuid id PK
        string name
        string phone
        string email
        enum default_payment_method
        timestamp created_at
    }

    RIDE_REQUESTS {
        uuid id PK
        uuid rider_id FK
        uuid driver_id FK
        float pickup_lat
        float pickup_lng
        float destination_lat
        float destination_lng
        enum status
        enum tier
        float surge_multiplier
        float estimated_fare
        int match_attempts
        uuid current_driver_offer_id
        timestamp created_at
    }

    DRIVER_OFFERS {
        uuid id PK
        uuid ride_request_id FK
        uuid driver_id FK
        enum status
        float distance_km
        timestamp expires_at
        timestamp responded_at
        timestamp created_at
    }

    TRIPS {
        uuid id PK
        uuid ride_request_id FK
        uuid driver_id FK
        uuid rider_id FK
        enum status
        float surge_multiplier
        float start_lat
        float start_lng
        float end_lat
        float end_lng
        float distance_km
        int duration_minutes
        float fare_amount
        timestamp start_time
        timestamp end_time
    }

    PAYMENTS {
        uuid id PK
        uuid trip_id FK
        float amount
        enum status
        enum method
        string transaction_id
        timestamp created_at
    }
```

---

## 5. API Contracts

### 5.1 Create Ride Request

```http
POST /api/v1/rides
Idempotency-Key: {uuid}
Content-Type: application/json

{
  "riderId": "uuid",
  "pickup": { "lat": 12.9716, "lng": 77.5946 },
  "destination": { "lat": 12.98, "lng": 77.61 },
  "tier": "ECONOMY | PREMIUM | XL",
  "paymentMethod": "CARD | WALLET | CASH"
}

Response 201:
{
  "id": "uuid",
  "status": "MATCHING",
  "surgeMultiplier": 1.5,
  "estimatedFare": 253.26,
  "matchedDriver": {
    "driverId": "uuid",
    "distanceKm": 0.5,
    "eta": 3
  }
}
```

### 5.2 Driver Response

```http
POST /api/v1/rides/{rideId}/driver-response
Content-Type: application/json

{
  "driverId": "uuid",
  "action": "ACCEPT | DECLINE"
}

Response 200:
{
  "rideId": "uuid",
  "status": "ACCEPTED | DECLINED",
  "message": "Ride accepted successfully"
}
```

---

## 6. Event Schemas

### 6.1 Kafka Topics & Events

| Topic            | Event           | Payload                                          |
| ---------------- | --------------- | ------------------------------------------------ |
| `ride.requested` | Ride created    | `{ rideId, riderId, pickup, destination, tier }` |
| `ride.matched`   | Driver assigned | `{ rideId, driverId, eta, offerExpiresAt }`      |
| `ride.accepted`  | Driver accepted | `{ rideId, driverId, timestamp }`                |
| `ride.declined`  | Driver declined | `{ rideId, driverId, reason }`                   |
| `ride.expired`   | Offer timeout   | `{ rideId, driverId, offerId }`                  |
| `trip.started`   | Trip began      | `{ tripId, driverId, startLocation }`            |
| `trip.completed` | Trip ended      | `{ tripId, fare, distance, duration }`           |
| `surge.updated`  | Surge changed   | `{ geoCell, region, multiplier }`                |

---

## 7. Redis Data Structures

### 7.1 Keys & Patterns

| Key Pattern                  | Type   | Purpose             | TTL  |
| ---------------------------- | ------ | ------------------- | ---- |
| `drivers:locations:{region}` | GEO    | Driver positions    | None |
| `driver:{id}:presence`       | STRING | Online detection    | 30s  |
| `driver:{id}:meta`           | HASH   | Status, vehicleType | None |
| `surge:{region}:{geoCell}`   | STRING | Cached surge        | 60s  |
| `demand:{region}:{geoCell}`  | STRING | Request counter     | 5min |
| `offer:{rideId}:{driverId}`  | STRING | Offer expiry        | 15s  |
| `idempotency:{key}`          | STRING | Request dedup       | 24h  |

---

## 8. Timeout & Reassignment Flow

```mermaid
sequenceDiagram
    participant D as Dispatch Service
    participant R as Redis
    participant K as Kafka
    participant DR as Driver

    D->>R: SET offer:{rideId}:{driverId} EX 15
    D->>K: Publish ride.matched
    K->>DR: Push notification

    alt Driver accepts within 15s
        DR->>D: Accept offer
        D->>R: DEL offer:{rideId}:{driverId}
        D->>K: Publish ride.accepted
    else Driver declines
        DR->>D: Decline offer
        D->>D: Find next driver
        D->>K: Publish ride.declined
    else Timeout (15s)
        Note over R: Key expires automatically
        D->>D: Check timeout (poll/cron)
        D->>D: Increment match_attempts
        alt attempts < MAX_ATTEMPTS
            D->>D: Find next driver
        else attempts >= MAX_ATTEMPTS
            D->>K: Publish ride.failed
        end
    end
```

---

## 9. Concurrency Considerations

### 9.1 Race Conditions Handled

1. **Double acceptance**: Use Redis SETNX + PostgreSQL transaction
2. **Offer already expired**: Check Redis before accepting
3. **Driver already on trip**: Filter by meta.status = 'ONLINE'
4. **Concurrent ride requests**: Idempotency key prevents duplicates

### 9.2 Locking Strategy

```javascript
// Optimistic locking with version
async function acceptOffer(rideId, driverId) {
  const lockKey = `lock:ride:${rideId}`;
  const acquired = await redis.set(lockKey, '1', 'NX', 'EX', 5);

  if (!acquired) {
    throw new Error('Ride is being processed');
  }

  try {
    // Check offer still valid
    const offerKey = `offer:${rideId}:${driverId}`;
    if (!(await redis.exists(offerKey))) {
      throw new Error('Offer expired');
    }

    // Update in transaction
    await db.transaction(async (tx) => {
      await tx.query('UPDATE ride_requests SET status = $1 WHERE id = $2', [
        'ACCEPTED',
        rideId,
      ]);
      await tx.query('UPDATE driver_offers SET status = $1 WHERE id = $2', [
        'ACCEPTED',
        offerId,
      ]);
    });

    await redis.del(offerKey);
  } finally {
    await redis.del(lockKey);
  }
}
```
