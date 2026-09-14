/**
 * ACED Route — Geospatial Math & Navigation Utilities
 * Provides high-precision distance, bearing, and cross-track calculations for real-time guidance.
 */

import { getCachedCoordinates } from './geocodeCache.js';

const EARTH_RADIUS_METERS = 6371000;

/**
 * Robust coordinate extractor for manifest stops.
 * Handles [lng, lat], [lat, lng], and object forms ({ lat, lng } / { latitude, longitude } / { lon, lat }).
 * Falls back to geocode cache by address.
 * Returns standard [lng, lat] GeoJSON array or null.
 */
export function getStopCoords(stop) {
  if (!stop) return null;

  // 1. Array coordinates: [lng, lat]
  const raw = stop.address?.location?.coordinates || stop.coordinates || stop.location?.coordinates;
  if (Array.isArray(raw) && raw.length >= 2) {
    let lng = parseFloat(raw[0]);
    let lat = parseFloat(raw[1]);
    // Safety check if coordinates were stored as [lat, lng] instead of [lng, lat]
    if (lat < 0 && lng > 0) {
      const tmp = lng;
      lng = lat;
      lat = tmp;
    }
    if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return [lng, lat];
    }
  }

  // 2. Object latitude/longitude fields
  const obj = (typeof stop.address === 'object' && stop.address !== null) ? stop.address : stop;
  const latVal = obj.latitude ?? obj.lat;
  const lngVal = obj.longitude ?? obj.lng ?? obj.lon;
  if (latVal != null && lngVal != null) {
    let lat = parseFloat(latVal);
    let lng = parseFloat(lngVal);
    if (lat < 0 && lng > 0) {
      const tmp = lng;
      lng = lat;
      lat = tmp;
    }
    if (!isNaN(lng) && !isNaN(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return [lng, lat];
    }
  }

  // 3. Fallback to geocode cache by address
  const addrStr = typeof stop === 'string'
    ? stop
    : (typeof stop.address === 'string'
        ? stop.address
        : (stop.address?.street || stop.address?.raw || stop.address?.normalizedAddress || stop.street || stop.raw || ''));
  if (addrStr) {
    const cached = getCachedCoordinates(addrStr);
    if (cached && Array.isArray(cached) && cached.length >= 2) {
      return [cached[0], cached[1]];
    }
  }

  return null;
}

/**
 * Fast bitwise polyline6 decoder for Valhalla's 1e-6 delta-encoded geometry strings.
 * Returns array of [longitude, latitude] GeoJSON number pairs.
 */
export function decodePolyline6(str) {
  if (!str) return [];
  let index = 0, lat = 0, lng = 0;
  const coordinates = [];
  const factor = 1e6;
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    coordinates.push([Number((lng / factor).toFixed(6)), Number((lat / factor).toFixed(6))]);
  }
  return coordinates;
}

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
