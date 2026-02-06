-- Multi-Region Ride-Hailing Platform Database Schema

-- Drivers table
CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    vehicle_type VARCHAR(50) NOT NULL, -- 'ECONOMY', 'PREMIUM', 'XL'
    license_plate VARCHAR(20) NOT NULL,
    rating DECIMAL(3, 2) DEFAULT 5.00,
    acceptance_rate DECIMAL(5, 2) DEFAULT 100.00,
    status VARCHAR(20) DEFAULT 'OFFLINE', -- 'ONLINE', 'OFFLINE', 'ON_TRIP'
    region VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Riders table
CREATE TABLE IF NOT EXISTS riders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    default_payment_method VARCHAR(50), -- 'CARD', 'WALLET', 'CASH'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ride requests table
CREATE TABLE IF NOT EXISTS ride_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rider_id UUID REFERENCES riders(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    pickup_lat DECIMAL(10, 8) NOT NULL,
    pickup_lng DECIMAL(11, 8) NOT NULL,
    pickup_address TEXT,
    destination_lat DECIMAL(10, 8) NOT NULL,
    destination_lng DECIMAL(11, 8) NOT NULL,
    destination_address TEXT,
    tier VARCHAR(50) NOT NULL, -- 'ECONOMY', 'PREMIUM', 'XL'
    payment_method VARCHAR(50) NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING', -- 'PENDING', 'MATCHING', 'MATCHED', 'ACCEPTED', 'CANCELLED', 'EXPIRED'
    surge_multiplier DECIMAL(3, 2) DEFAULT 1.00,
    estimated_fare DECIMAL(10, 2),
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    match_attempts INTEGER DEFAULT 0,
    current_driver_offer_id UUID,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Driver offers (for matching/dispatch)
CREATE TABLE IF NOT EXISTS driver_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_request_id UUID REFERENCES ride_requests(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE CASCADE,
    status VARCHAR(30) DEFAULT 'PENDING', -- 'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED'
    offered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    responded_at TIMESTAMP WITH TIME ZONE,
    decline_reason VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Trips table
CREATE TABLE IF NOT EXISTS trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_request_id UUID UNIQUE REFERENCES ride_requests(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
    rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
    status VARCHAR(30) DEFAULT 'PENDING', -- 'PENDING', 'STARTED', 'PAUSED', 'COMPLETED', 'CANCELLED'
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    pause_time TIMESTAMP WITH TIME ZONE,
    total_pause_duration INTEGER DEFAULT 0, -- in seconds
    start_lat DECIMAL(10, 8),
    start_lng DECIMAL(11, 8),
    end_lat DECIMAL(10, 8),
    end_lng DECIMAL(11, 8),
    distance_km DECIMAL(10, 3),
    duration_minutes INTEGER,
    base_fare DECIMAL(10, 2),
    distance_fare DECIMAL(10, 2),
    time_fare DECIMAL(10, 2),
    surge_multiplier DECIMAL(3, 2) DEFAULT 1.00,
    total_fare DECIMAL(10, 2),
    route_polyline TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
    rider_id UUID REFERENCES riders(id) ON DELETE SET NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'INR',
    payment_method VARCHAR(50) NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED'
    psp_transaction_id VARCHAR(255),
    psp_name VARCHAR(50),
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Surge pricing cache (for reference, main cache in Redis)
CREATE TABLE IF NOT EXISTS surge_pricing_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    geo_cell VARCHAR(50) NOT NULL, -- H3 cell index
    region VARCHAR(50) NOT NULL,
    supply_count INTEGER NOT NULL,
    demand_count INTEGER NOT NULL,
    surge_multiplier DECIMAL(3, 2) NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Idempotency keys tracking
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    request_hash VARCHAR(64) NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_drivers_status_region ON drivers(status, region);
CREATE INDEX IF NOT EXISTS idx_ride_requests_status ON ride_requests(status);
CREATE INDEX IF NOT EXISTS idx_ride_requests_rider ON ride_requests(rider_id);
CREATE INDEX IF NOT EXISTS idx_ride_requests_driver ON ride_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_offers_ride_request ON driver_offers(ride_request_id);
CREATE INDEX IF NOT EXISTS idx_driver_offers_driver ON driver_offers(driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);
CREATE INDEX IF NOT EXISTS idx_trips_rider ON trips(rider_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_payments_trip ON payments(trip_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_surge_pricing_log_geo_cell ON surge_pricing_log(geo_cell, recorded_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires ON idempotency_keys(expires_at);

-- Seed some test data
INSERT INTO drivers (id, name, phone, vehicle_type, license_plate, status, region) VALUES
    ('d1000000-0000-0000-0000-000000000001', 'Driver One', '+91-9876543210', 'ECONOMY', 'KA01AB1234', 'ONLINE', 'bangalore'),
    ('d1000000-0000-0000-0000-000000000002', 'Driver Two', '+91-9876543211', 'PREMIUM', 'KA01CD5678', 'ONLINE', 'bangalore'),
    ('d1000000-0000-0000-0000-000000000003', 'Driver Three', '+91-9876543212', 'XL', 'KA01EF9012', 'ONLINE', 'bangalore')
ON CONFLICT DO NOTHING;

INSERT INTO riders (id, name, phone, email, default_payment_method) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'Rider One', '+91-9988776655', 'rider1@test.com', 'CARD'),
    ('a1000000-0000-0000-0000-000000000002', 'Rider Two', '+91-9988776656', 'rider2@test.com', 'WALLET')
ON CONFLICT DO NOTHING;
