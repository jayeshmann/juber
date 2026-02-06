/**
 * Convert latitude/longitude to an H3-like geo cell identifier
 * Simplified implementation - in production use h3-js library
 */
const latLngToGeoCell = (lat, lng, resolution = 8) => {
  // Simplified geo cell using grid-based approach
  // Resolution 8 ≈ 0.5km cell size
  const latGrid = Math.floor(lat * 1000);
  const lngGrid = Math.floor(lng * 1000);
  return `h3_${resolution}${latGrid}${lngGrid}ffffff`;
};

/**
 * Calculate distance between two points using Haversine formula
 * @returns distance in kilometers
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toRad = (deg) => deg * (Math.PI / 180);

/**
 * Get neighboring geo cells (for surge calculation across boundaries)
 */
const getNeighboringCells = (geoCell) => {
  // Extract lat/lng grids from cell
  const match = geoCell.match(/h3_(\d)(-?\d+)(-?\d+)ffffff/);
  if (!match) return [geoCell];

  const resolution = parseInt(match[1]);
  const latGrid = parseInt(match[2]);
  const lngGrid = parseInt(match[3]);

  const neighbors = [];
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      neighbors.push(`h3_${resolution}${latGrid + dLat}${lngGrid + dLng}ffffff`);
    }
  }
  return neighbors;
};

/**
 * Validate coordinates
 */
const isValidCoordinate = (lat, lng) => {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
};

/**
 * Determine region from coordinates
 * Simplified - in production use reverse geocoding
 */
const getRegionFromCoordinates = (lat, lng) => {
  // Bangalore approximate bounds
  if (lat >= 12.7 && lat <= 13.2 && lng >= 77.4 && lng <= 77.8) {
    return 'bangalore';
  }
  // Mumbai
  if (lat >= 18.8 && lat <= 19.3 && lng >= 72.7 && lng <= 73.0) {
    return 'mumbai';
  }
  // Delhi
  if (lat >= 28.4 && lat <= 28.9 && lng >= 76.8 && lng <= 77.4) {
    return 'delhi';
  }
  return 'bangalore'; // Default
};

module.exports = {
  latLngToGeoCell,
  calculateDistance,
  getNeighboringCells,
  isValidCoordinate,
  getRegionFromCoordinates
};
