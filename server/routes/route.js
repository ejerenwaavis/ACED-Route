const express = require('express');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();
router.use(requireAuth);

/**
 * Fast bitwise polyline6 decoder for Valhalla's 1e-6 delta-encoded geometry strings.
 * Returns array of [longitude, latitude] GeoJSON number pairs.
 */
function decodePolyline6(str) {
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

const VALHALLA_BASE = process.env.VALHALLA_URL || 'http://localhost:8002';
const VALHALLA_FALLBACK = 'https://valhalla1.openstreetmap.de';

async function queryValhalla(payload) {
  // 1. Try local/configured Valhalla instance
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${VALHALLA_BASE}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    // Local container unreachable or still building tiles
  }

  // 2. Fallback to live Valhalla instance (with parallel chunking for > 10 locations)
  if (VALHALLA_BASE !== VALHALLA_FALLBACK) {
    try {
      if (payload.locations && payload.locations.length > 10) {
        const locations = payload.locations;
        const chunks = [];
        for (let i = 0; i < locations.length - 1; i += 9) {
          const slice = locations.slice(i, Math.min(locations.length, i + 10));
          if (slice.length >= 2) chunks.push(slice);
        }
        const chunkResults = await Promise.all(
          chunks.map(async (slice) => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 7000);
            const res = await fetch(`${VALHALLA_FALLBACK}/route`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payload, locations: slice }),
              signal: controller.signal
            });
            clearTimeout(timeout);
            if (!res.ok) return null;
            return await res.json();
          })
        );
        if (chunkResults.every(r => r && r.trip && r.trip.legs)) {
          const combinedLegs = [];
          let totalLength = 0;
          let totalTime = 0;
          for (const cr of chunkResults) {
            totalLength += (cr.trip.summary?.length || 0);
            totalTime += (cr.trip.summary?.time || 0);
            combinedLegs.push(...cr.trip.legs);
          }
          return {
            trip: {
              legs: combinedLegs,
              summary: { length: totalLength, time: totalTime }
            }
          };
        }
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        const res = await fetch(`${VALHALLA_FALLBACK}/route`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (res.ok) {
          return await res.json();
        }
      }
    } catch (err) {
      // Fallback failed
    }
  }

  throw new Error('Valhalla routing service unreachable');
}

function logServerEvent(type, message, meta = {}) {
  const ts = new Date().toISOString();
  console.log(`[Route API] [${ts}] [${type}] ${message}`, Object.keys(meta).length ? JSON.stringify(meta) : '');
}

/**
 * POST /api/route/sequence
 * Multi-waypoint solve across all manifest stops in a single continuous Valhalla request.
 * Request: { stops: [[lng, lat], ...], costing?: string }
 * Response: { coordinates, distanceMeters, durationSeconds, isRoadSnapped: true }
 */
router.post('/sequence', requireAuth, async (req, res) => {
  const startTs = Date.now();
  try {
    const { stops, costing = 'auto' } = req.body;
    if (!Array.isArray(stops) || stops.length < 2) {
      logServerEvent('WARN', 'POST /sequence invalid payload: fewer than 2 stops');
      return res.status(400).json({ error: 'Must provide an array of at least 2 stop [lng, lat] coordinate pairs' });
    }

    logServerEvent('INFO', `POST /sequence processing ${stops.length} stops (costing=${costing})`, {
      user: req.user?.id || req.user?.email || 'authenticated',
      firstStop: stops[0],
      lastStop: stops[stops.length - 1]
    });

    // Build locations array with type: 'break' for every stop
    const locations = stops.map(pt => ({
      lon: Number(pt[0]),
      lat: Number(pt[1]),
      type: 'break'
    }));

    const valhallaReq = {
      locations,
      costing,
      directions_options: {
        units: 'kilometers',
        language: 'en-US'
      }
    };

    const data = await queryValhalla(valhallaReq);
    if (!data || !data.trip || !data.trip.legs) {
      logServerEvent('ERROR', 'POST /sequence Valhalla returned no trip legs');
      return res.status(502).json({ error: 'Valhalla returned no trip legs' });
    }

    // Concatenate all legs into one continuous coordinate array, skipping duplicate junction points
    const allCoords = [];
    for (let i = 0; i < data.trip.legs.length; i++) {
      const leg = data.trip.legs[i];
      const legCoords = decodePolyline6(leg.shape);
      for (let j = 0; j < legCoords.length; j++) {
        if (i > 0 && j === 0) continue;
        allCoords.push(legCoords[j]);
      }
    }

    const distanceMeters = Math.round((data.trip.summary?.length || 0) * 1000);
    const durationSeconds = Math.round(data.trip.summary?.time || 0);
    const elapsed = Date.now() - startTs;

    logServerEvent('SUCCESS', `POST /sequence solved: ${allCoords.length} coords, ${distanceMeters}m (${(distanceMeters/1609.34).toFixed(1)}mi) in ${elapsed}ms`);

    return res.json({
      coordinates: allCoords,
      distanceMeters,
      durationSeconds,
      isRoadSnapped: true
    });
  } catch (err) {
    const elapsed = Date.now() - startTs;
    logServerEvent('ERROR', `POST /sequence failed after ${elapsed}ms: ${err.message}`);
    return res.status(503).json({ error: 'Route calculation unavailable: ' + err.message });
  }
});

/**
 * POST /api/route/active
 * Two-point route solve from current driver location to target stop.
 * Request: { start: [lng, lat], end: [lng, lat], costing?: string }
 * Response: { coordinates, distanceMeters, durationSeconds, instructions, isRoadSnapped: true }
 */
router.post('/active', requireAuth, async (req, res) => {
  const startTs = Date.now();
  try {
    const { start, end, costing = 'auto' } = req.body;
    if (!Array.isArray(start) || start.length < 2 || !Array.isArray(end) || end.length < 2) {
      logServerEvent('WARN', 'POST /active invalid payload: missing start or end coordinates');
      return res.status(400).json({ error: 'Must provide start [lng, lat] and end [lng, lat] coordinate pairs' });
    }

    logServerEvent('INFO', `POST /active processing leg [${start[0].toFixed(4)},${start[1].toFixed(4)}] -> [${end[0].toFixed(4)},${end[1].toFixed(4)}]`, {
      user: req.user?.id || req.user?.email || 'authenticated',
      costing
    });

    const locations = [
      { lon: Number(start[0]), lat: Number(start[1]), type: 'break' },
      { lon: Number(end[0]), lat: Number(end[1]), type: 'break' }
    ];

    const valhallaReq = {
      locations,
      costing,
      directions_options: {
        units: 'kilometers',
        language: 'en-US'
      }
    };

    const data = await queryValhalla(valhallaReq);
    if (!data || !data.trip || !data.trip.legs || !data.trip.legs[0]) {
      logServerEvent('ERROR', 'POST /active Valhalla returned no trip legs');
      return res.status(502).json({ error: 'Valhalla returned no trip legs' });
    }

    const leg = data.trip.legs[0];
    const coordinates = decodePolyline6(leg.shape);
    const distanceMeters = Math.round((data.trip.summary?.length || 0) * 1000);
    const durationSeconds = Math.round(data.trip.summary?.time || 0);

    // Standardize maneuvers
    const instructions = (leg.maneuvers || []).map(m => ({
      instruction: m.instruction || 'Continue',
      streetNames: m.street_names || [],
      distanceMeters: Math.round((m.length || 0) * 1000),
      timeSeconds: Math.round(m.time || 0),
      type: m.type || 1
    }));

    const elapsed = Date.now() - startTs;
    logServerEvent('SUCCESS', `POST /active solved: ${coordinates.length} coords, ${distanceMeters}m (${(distanceMeters/1609.34).toFixed(1)}mi), ${instructions.length} maneuvers in ${elapsed}ms`);

    return res.json({
      coordinates,
      distanceMeters,
      durationSeconds,
      instructions,
      isRoadSnapped: true
    });
  } catch (err) {
    const elapsed = Date.now() - startTs;
    logServerEvent('ERROR', `POST /active failed after ${elapsed}ms: ${err.message}`);
    return res.status(503).json({ error: 'Route calculation unavailable: ' + err.message });
  }
});

module.exports = router;
module.exports.decodePolyline6 = decodePolyline6;
