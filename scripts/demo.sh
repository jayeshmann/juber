#!/bin/bash

# =====================================================
# JUBER RIDE-HAILING PLATFORM - DEMO SCRIPT
# =====================================================

BASE_URL="http://localhost:3000/api/v1"

echo "============================================="
echo "🚗 JUBER RIDE-HAILING PLATFORM DEMO"
echo "============================================="
echo ""

# 1. Health Check
echo "1️⃣  HEALTH CHECK"
echo "---------------------------------------------"
curl -s "$BASE_URL/health" | jq .
echo ""

# 2. Update Driver Location (simulating driver going online)
echo "2️⃣  DRIVER 1 GOES ONLINE (Location Update)"
echo "---------------------------------------------"
curl -s -X POST "$BASE_URL/drivers/d1000000-0000-0000-0000-000000000001/location" \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 12.9716,
    "longitude": 77.5946,
    "heading": 45,
    "speed": 0
  }' | jq .
echo ""

# 3. Set Driver Status to ONLINE
echo "3️⃣  SET DRIVER STATUS TO ONLINE"
echo "---------------------------------------------"
curl -s -X PATCH "$BASE_URL/drivers/d1000000-0000-0000-0000-000000000001/status" \
  -H "Content-Type: application/json" \
  -d '{"status": "ONLINE"}' | jq .
echo ""

# 4. Find Nearby Drivers
echo "4️⃣  FIND NEARBY DRIVERS"
echo "---------------------------------------------"
curl -s "$BASE_URL/drivers/nearby?latitude=12.9716&longitude=77.5946&radiusKm=5&region=bangalore" | jq .
echo ""

# 5. Get Surge for Location
echo "5️⃣  CHECK SURGE PRICING"
echo "---------------------------------------------"
curl -s -X POST "$BASE_URL/surge/calculate" \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 12.9716,
    "longitude": 77.5946,
    "region": "bangalore"
  }' | jq .
echo ""

# 6. Create Ride Request
echo "6️⃣  CREATE RIDE REQUEST (Rider requests a ride)"
echo "---------------------------------------------"
RIDE_RESPONSE=$(curl -s -X POST "$BASE_URL/rides" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: demo-ride-$(date +%s)" \
  -d '{
    "riderId": "a1000000-0000-0000-0000-000000000001",
    "pickup": {"lat": 12.9716, "lng": 77.5946},
    "destination": {"lat": 12.98, "lng": 77.61},
    "tier": "ECONOMY",
    "paymentMethod": "CARD"
  }')
echo "$RIDE_RESPONSE" | jq .
RIDE_ID=$(echo "$RIDE_RESPONSE" | jq -r '.id')
echo ""

# 7. Driver Accepts Ride
echo "7️⃣  DRIVER ACCEPTS RIDE"
echo "---------------------------------------------"
curl -s -X POST "$BASE_URL/rides/$RIDE_ID/driver-response" \
  -H "Content-Type: application/json" \
  -d '{
    "driverId": "d1000000-0000-0000-0000-000000000001",
    "action": "ACCEPT"
  }' | jq .
echo ""

# 8. Create Trip
echo "8️⃣  CREATE TRIP (From accepted ride)"
echo "---------------------------------------------"
TRIP_RESPONSE=$(curl -s -X POST "$BASE_URL/trips" \
  -H "Content-Type: application/json" \
  -d "{\"rideRequestId\": \"$RIDE_ID\"}")
echo "$TRIP_RESPONSE" | jq .
TRIP_ID=$(echo "$TRIP_RESPONSE" | jq -r '.id')
echo ""

# 9. Start Trip
echo "9️⃣  START TRIP (Driver picks up rider)"
echo "---------------------------------------------"
curl -s -X POST "$BASE_URL/trips/$TRIP_ID/start" \
  -H "Content-Type: application/json" \
  -d '{
    "startLat": 12.9716,
    "startLng": 77.5946
  }' | jq .
echo ""

# 10. End Trip
echo "🔟  END TRIP (Reach destination)"
echo "---------------------------------------------"
curl -s -X POST "$BASE_URL/trips/$TRIP_ID/end" \
  -H "Content-Type: application/json" \
  -d '{
    "endLat": 12.98,
    "endLng": 77.61,
    "distanceKm": 5.2,
    "durationMinutes": 18
  }' | jq .
echo ""

# 11. Get Trip Receipt
echo "🧾  GET TRIP RECEIPT"
echo "---------------------------------------------"
curl -s "$BASE_URL/trips/$TRIP_ID/receipt" | jq .
echo ""

echo "============================================="
echo "✅ DEMO COMPLETE!"
echo "============================================="
echo ""
echo "Key IDs for further testing:"
echo "  Ride ID: $RIDE_ID"
echo "  Trip ID: $TRIP_ID"
echo ""
