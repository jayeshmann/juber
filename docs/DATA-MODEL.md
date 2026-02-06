# Data Model Documentation

## 1. Entity Relationship Diagram

```mermaid
erDiagram
    DRIVERS ||--o{ RIDE_REQUESTS : "assigned to"
    DRIVERS ||--o{ DRIVER_OFFERS : "receives"
    DRIVERS ||--o{ TRIPS : "drives"

    RIDERS ||--o{ RIDE_REQUESTS : "creates"
    RIDERS ||--o{ TRIPS : "takes"

    RIDE_REQUESTS ||--o{ DRIVER_OFFERS : "has"
    RIDE_REQUESTS ||--o| TRIPS : "becomes"

    TRIPS ||--o{ PAYMENTS : "has"

    DRIVERS {
        uuid id PK
        string name
        string phone UK
        enum vehicle_type "ECONOMY|PREMIUM|XL"
        string license_plate UK
        enum status "ONLINE|OFFLINE|ON_TRIP"
        string region
        float rating
        float acceptance_rate
        timestamp created_at
        timestamp updated_at
    }

    RIDERS {
        uuid id PK
        string name
        string phone UK
        string email UK
        enum default_payment_method "CARD|WALLET|CASH"
        timestamp created_at
    }

    RIDE_REQUESTS {
        uuid id PK
        uuid rider_id FK
        uuid driver_id FK "nullable"
        float pickup_lat
        float pickup_lng
        float destination_lat
        float destination_lng
        enum status "PENDING|MATCHING|DRIVER_OFFERED|ACCEPTED|..."
        enum tier "ECONOMY|PREMIUM|XL"
        float surge_multiplier
        float estimated_fare
        int match_attempts
        uuid current_driver_offer_id FK "nullable"
        string idempotency_key UK
        timestamp created_at
        timestamp updated_at
    }

    DRIVER_OFFERS {
        uuid id PK
        uuid ride_request_id FK
        uuid driver_id FK
        enum status "PENDING|ACCEPTED|DECLINED|EXPIRED"
        float distance_km
        int eta_minutes
        timestamp expires_at
        timestamp responded_at "nullable"
        timestamp created_at
    }

    TRIPS {
        uuid id PK
        uuid ride_request_id FK UK
        uuid driver_id FK
        uuid rider_id FK
        enum status "PENDING|STARTED|PAUSED|COMPLETED|CANCELLED"
        float surge_multiplier
        float start_lat "nullable"
        float start_lng "nullable"
        float end_lat "nullable"
        float end_lng "nullable"
        float distance_km "nullable"
        int duration_minutes "nullable"
        float fare_amount "nullable"
        enum payment_method "CARD|WALLET|CASH"
        timestamp start_time "nullable"
        timestamp end_time "nullable"
        timestamp created_at
        timestamp updated_at
    }

    PAYMENTS {
        uuid id PK
        uuid trip_id FK
        float amount
        enum status "PENDING|SUCCESS|FAILED|REFUNDED"
        enum method "CARD|WALLET|CASH"
        string transaction_id "nullable"
        string psp_reference "nullable"
        timestamp created_at
        timestamp updated_at
    }
```

---

## 2. Table Definitions

### 2.1 drivers

```sql
CREATE TABLE drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    vehicle_type VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('ECONOMY', 'PREMIUM', 'XL')),
    license_plate VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'ON_TRIP')),
    region VARCHAR(50) DEFAULT 'bangalore',
    rating DECIMAL(3,2) DEFAULT 4.5,
    acceptance_rate DECIMAL(3,2) DEFAULT 0.85,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_drivers_region_status ON drivers(region, status);
CREATE INDEX idx_drivers_vehicle_type ON drivers(vehicle_type);
```

### 2.2 riders

```sql
CREATE TABLE riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    default_payment_method VARCHAR(20) DEFAULT 'CARD'
        CHECK (default_payment_method IN ('CARD', 'WALLET', 'CASH')),
    created_at TIMESTAMP DEFAULT NOW()
);
```

### 2.3 ride_requests

```sql
CREATE TABLE ride_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID NOT NULL REFERENCES riders(id),
    driver_id UUID REFERENCES drivers(id),
    pickup_lat DECIMAL(10,7) NOT NULL,
    pickup_lng DECIMAL(10,7) NOT NULL,
    destination_lat DECIMAL(10,7) NOT NULL,
    destination_lng DECIMAL(10,7) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'MATCHING', 'DRIVER_OFFERED', 'ACCEPTED',
        'DECLINED', 'NO_DRIVERS', 'CANCELLED', 'FAILED'
    )),
    tier VARCHAR(20) NOT NULL CHECK (tier IN ('ECONOMY', 'PREMIUM', 'XL')),
    surge_multiplier DECIMAL(3,2) DEFAULT 1.0,
    estimated_fare DECIMAL(10,2),
    match_attempts INT DEFAULT 0,
    current_driver_offer_id UUID,
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_ride_requests_rider ON ride_requests(rider_id);
CREATE INDEX idx_ride_requests_driver ON ride_requests(driver_id);
CREATE INDEX idx_ride_requests_status ON ride_requests(status);
CREATE INDEX idx_ride_requests_created ON ride_requests(created_at);
```

### 2.4 driver_offers

```sql
CREATE TABLE driver_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_request_id UUID NOT NULL REFERENCES ride_requests(id),
    driver_id UUID NOT NULL REFERENCES drivers(id),
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
    distance_km DECIMAL(10,3),
    eta_minutes INT,
    expires_at TIMESTAMP NOT NULL,
    responded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_driver_offers_ride ON driver_offers(ride_request_id);
CREATE INDEX idx_driver_offers_driver ON driver_offers(driver_id);
CREATE INDEX idx_driver_offers_expires ON driver_offers(expires_at) WHERE status = 'PENDING';
```

### 2.5 trips

```sql
CREATE TABLE trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_request_id UUID UNIQUE NOT NULL REFERENCES ride_requests(id),
    driver_id UUID NOT NULL REFERENCES drivers(id),
    rider_id UUID NOT NULL REFERENCES riders(id),
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'STARTED', 'PAUSED', 'COMPLETED', 'CANCELLED'
    )),
    surge_multiplier DECIMAL(3,2) DEFAULT 1.0,
    start_lat DECIMAL(10,7),
    start_lng DECIMAL(10,7),
    end_lat DECIMAL(10,7),
    end_lng DECIMAL(10,7),
    distance_km DECIMAL(10,3),
    duration_minutes INT,
    fare_amount DECIMAL(10,2),
    payment_method VARCHAR(20) DEFAULT 'CARD',
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_trips_driver ON trips(driver_id);
CREATE INDEX idx_trips_rider ON trips(rider_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_trips_created ON trips(created_at);
```

### 2.6 payments

```sql
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id),
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'
    )),
    method VARCHAR(20) NOT NULL,
    transaction_id VARCHAR(100),
    psp_reference VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_payments_trip ON payments(trip_id);
CREATE INDEX idx_payments_status ON payments(status);
```

---

## 3. Redis Data Structures

### 3.1 Driver Location (GEO)

```
Key: drivers:locations:{region}
Type: SORTED SET (GEO)
Members: driverId -> (longitude, latitude)

Commands:
- GEOADD drivers:locations:bangalore 77.5946 12.9716 driver1
- GEORADIUS drivers:locations:bangalore 77.59 12.97 5 km WITHDIST ASC
```

### 3.2 Driver Metadata (HASH)

```
Key: driver:{driverId}:meta
Type: HASH
Fields:
  - status: ONLINE | OFFLINE | ON_TRIP
  - vehicleType: ECONOMY | PREMIUM | XL
  - lastLat: latitude
  - lastLng: longitude
  - lastUpdate: ISO8601 timestamp
  - heading: 0-360 degrees
  - speed: km/h
  - geoCell: H3 geo cell ID
```

### 3.3 Driver Presence (STRING)

```
Key: driver:{driverId}:presence
Type: STRING
Value: "1"
TTL: 30 seconds (refreshed on each location update)
```

### 3.4 Surge Cache (STRING)

```
Key: surge:{region}:{geoCell}
Type: STRING
Value: JSON { multiplier, demand, supply, calculatedAt }
TTL: 60 seconds
```

### 3.5 Demand Counter (STRING)

```
Key: demand:{region}:{geoCell}
Type: STRING (counter)
Value: Integer count of ride requests
TTL: 5 minutes
```

### 3.6 Driver Offer Expiry (STRING)

```
Key: offer:{rideId}:{driverId}
Type: STRING
Value: "1"
TTL: 15 seconds (offer timeout)
```

### 3.7 Idempotency Cache (STRING)

```
Key: idempotency:{key}
Type: STRING
Value: JSON { requestHash, response }
TTL: 24 hours
```

---

## 4. Query Patterns

### 4.1 Common Read Queries

| Query                      | Table                    | Index Used                       | Expected Latency |
| -------------------------- | ------------------------ | -------------------------------- | ---------------- |
| Get ride by ID             | ride_requests            | PK                               | < 5ms            |
| Get active rides for rider | ride_requests            | idx_ride_requests_rider + status | < 10ms           |
| Get driver's current trip  | trips                    | idx_trips_driver + status        | < 10ms           |
| Get trip with receipt data | trips + riders + drivers | JOIN on PKs                      | < 20ms           |

### 4.2 Write Patterns

| Operation           | Tables                       | Transaction? | Notes                          |
| ------------------- | ---------------------------- | ------------ | ------------------------------ |
| Create ride request | ride_requests                | No           | Single insert                  |
| Accept ride         | ride_requests, driver_offers | Yes          | Multi-table update             |
| Complete trip       | trips, drivers               | Yes          | Update fare + driver status    |
| Process payment     | payments, trips              | Yes          | Idempotent with transaction_id |

---

## 5. Data Lifecycle

| Entity         | Hot Storage | Archive After   | Delete After    |
| -------------- | ----------- | --------------- | --------------- |
| driver_offers  | PostgreSQL  | 30 days         | 90 days         |
| ride_requests  | PostgreSQL  | 90 days         | 1 year          |
| trips          | PostgreSQL  | 1 year          | 7 years (legal) |
| payments       | PostgreSQL  | Never           | Never (audit)   |
| Redis location | Redis       | N/A (ephemeral) | 30s TTL         |
| Redis surge    | Redis       | N/A (ephemeral) | 60s TTL         |
