# Juber - Multi-Region Ride-Hailing Platform

A scalable, multi-tenant ride-hailing system built with Express.js, designed to handle:
- **300k concurrent drivers** globally
- **60k ride requests/minute** at peak
- **500k location updates/second** globally

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### Setup

```bash
# Clone and install dependencies
npm install

# Start infrastructure (PostgreSQL, Redis, Kafka)
npm run docker:up

# Start development server
npm run dev
```

### Run Tests

```bash
# Run all tests
npm test

# Run integration tests only
npm run test:integration

# Run with coverage
npm run test:coverage
```

## 📁 Project Structure

```
juber-2/
├── src/
│   ├── app.js                    # Express app setup
│   ├── server.js                 # Server entry point
│   ├── config/                   # Configuration management
│   ├── controllers/              # Request handlers
│   ├── services/                 # Business logic
│   ├── routes/                   # API route definitions
│   ├── middleware/               # Express middleware
│   ├── events/                   # Kafka producers/consumers
│   ├── db/                       # Database clients
│   └── utils/                    # Utility functions
├── tests/
│   ├── integration/              # Integration tests
│   └── setup.js                  # Test setup with testcontainers
├── scripts/
│   └── init-db.sql               # Database schema
└── docker-compose.yml            # Local development infrastructure
```

## 🔌 API Endpoints

### Driver Location Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/drivers/:id/location` | Update driver location |
| GET | `/api/v1/drivers/:id/location` | Get driver location |
| GET | `/api/v1/drivers/nearby` | Find nearby drivers |
| PATCH | `/api/v1/drivers/:id/status` | Update driver status |

### Ride Dispatch Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/rides` | Create ride request (requires `Idempotency-Key`) |
| GET | `/api/v1/rides/:id` | Get ride details |
| POST | `/api/v1/rides/:id/driver-response` | Driver accept/decline |
| POST | `/api/v1/rides/:id/cancel` | Cancel ride |

### Trip Lifecycle Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/trips` | Create trip from accepted ride |
| GET | `/api/v1/trips/:id` | Get trip details |
| POST | `/api/v1/trips/:id/start` | Start trip |
| POST | `/api/v1/trips/:id/pause` | Pause trip |
| POST | `/api/v1/trips/:id/resume` | Resume trip |
| POST | `/api/v1/trips/:id/end` | End trip & calculate fare |
| POST | `/api/v1/trips/:id/cancel` | Cancel trip |
| GET | `/api/v1/trips/:id/receipt` | Get trip receipt |

### Surge Pricing Service
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/surge/:geoCell` | Get surge for geo cell |
| POST | `/api/v1/surge/calculate` | Calculate surge for location |
| GET | `/api/v1/surge/region/:region` | Get all surge zones |
| POST | `/api/v1/surge/demand` | Increment demand counter |

## 🏗️ Architecture

### Core Components

1. **Driver Location Service**
   - Real-time location ingestion (1-2 updates/sec per driver)
   - Redis GEO for proximity searches
   - TTL-based presence detection

2. **Dispatch/Matching Service** (Deep Dive LLD)
   - Score-based driver matching
   - 15-second response timeout with auto-reassign
   - Idempotent ride requests

3. **Surge Pricing Service**
   - Supply/demand ratio calculation per geo-cell
   - 60-second cache with Redis
   - Surge range: 1.0x - 3.0x

4. **Trip Lifecycle Service**
   - State machine: PENDING → STARTED → PAUSED → COMPLETED/CANCELLED
   - Fare calculation with surge multiplier
   - Receipt generation

### Resilience Patterns

- **Idempotency**: All mutating endpoints support idempotency keys
- **Circuit Breakers**: External service calls protected with Opossum
- **Rate Limiting**: Sliding window rate limiting with Redis
- **Graceful Shutdown**: Proper cleanup of connections

### Event Topics (Kafka)

| Topic | Description |
|-------|-------------|
| `ride.requested` | New ride request created |
| `ride.matched` | Driver assigned to ride |
| `ride.accepted` | Driver accepted ride |
| `ride.declined` | Driver declined ride |
| `driver.location.updated` | Driver location update |
| `trip.started` | Trip started |
| `trip.completed` | Trip completed with fare |
| `surge.updated` | Surge multiplier changed |

## 📊 SLOs

| Metric | Target |
|--------|--------|
| Dispatch decision latency | p95 ≤ 1s |
| End-to-end request→acceptance | p95 ≤ 3s |
| Dispatch API availability | 99.95% |

## 🔧 Configuration

See `.env.example` for all configuration options.

## 📝 License

MIT
