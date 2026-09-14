/**
 * ACED Route — Geospatial Math & Navigation Utilities
 * Provides high-precision distance, bearing, and cross-track calculations for real-time guidance.
 */

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates great-circle distance between two coordinates in meters.
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Calculates initial bearing from point 1 to point 2 in degrees (0 - 360).
 */
export function bearingBetween(lat1, lon1, lat2, lon2) {
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.cos(((lon2 - lon1) * Math.PI) / 180);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

/**
 * Calculates minimum distance (in meters) from a point P to a line segment AB.
 */
export function pointToSegmentDistance(pLat, pLon, aLat, aLon, bLat, bLon) {
  const lengthSquared =
    (bLat - aLat) * (bLat - aLat) + (bLon - aLon) * (bLon - aLon);

  if (lengthSquared === 0) {
    return haversineDistance(pLat, pLon, aLat, aLon);
  }

  // Projection scalar t on line segment AB
  let t =
    ((pLat - aLat) * (bLat - aLat) + (pLon - aLon) * (bLon - aLon)) /
    lengthSquared;
  t = Math.max(0, Math.min(1, t));

  const projLat = aLat + t * (bLat - aLat);
  const projLon = aLon + t * (bLon - aLon);

  return haversineDistance(pLat, pLon, projLat, projLon);
}

/**
 * Calculates minimum cross-track distance in meters from a GPS coordinate
 * to an entire route polyline (coordinates array in [lng, lat] GeoJSON format).
 *
 * Returns { distance: number, nearestSegmentIndex: number }
 */
export function distanceToPolyline(pLat, pLon, coordinates) {
  if (!coordinates || coordinates.length === 0) {
    return { distance: Infinity, nearestSegmentIndex: -1 };
  }

  if (coordinates.length === 1) {
    return {
      distance: haversineDistance(pLat, pLon, coordinates[0][1], coordinates[0][0]),
      nearestSegmentIndex: 0,
    };
  }

  let minDistance = Infinity;
  let nearestSegmentIndex = 0;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const aLon = coordinates[i][0];
    const aLat = coordinates[i][1];
    const bLon = coordinates[i + 1][0];
    const bLat = coordinates[i + 1][1];

    const d = pointToSegmentDistance(pLat, pLon, aLat, aLon, bLat, bLon);
    if (d < minDistance) {
      minDistance = d;
      nearestSegmentIndex = i;
    }
  }

  return { distance: minDistance, nearestSegmentIndex };
}

/**
 * Formats distance in imperial (ft, mi) or metric (m, km).
 */
export function formatDistance(meters, unit = 'imperial') {
  if (meters == null || isNaN(meters)) return '';

  if (unit === 'imperial') {
    const feet = meters * 3.28084;
    if (feet < 1000) {
      // Round to nearest 10 or 50 ft
      const rounded = Math.round(feet / 10) * 10;
      return `${Math.max(10, rounded)} ft`;
    }
    const miles = meters / 1609.344;
    return `${miles.toFixed(1)} mi`;
  } else {
    if (meters < 1000) {
      const rounded = Math.round(meters / 10) * 10;
      return `${Math.max(10, rounded)} m`;
    }
    const km = meters / 1000;
    return `${km.toFixed(1)} km`;
  }
}
