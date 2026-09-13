const express = require('express');
const Manifest = require('../models/Manifest');
const RouteEdge = require('../models/RouteEdge');
const requireAuth = require('../middleware/requireAuth');
const { getOrGeocodeAddress } = require('../utils/geocode');

const router = express.Router();

/**
 * GET /api/manifest
 * Returns all manifests for the authenticated driver.
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const manifests = await Manifest.find({ driver: req.user.sub })
      .sort({ routeDate: -1, createdAt: -1 })
      .populate('stops.address')
      .lean();
    res.json(manifests);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/manifest/:id
 * Returns the manifest populated with Address documents.
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const manifest = await Manifest.findById(req.params.id).populate('stops.address');
    if (!manifest) return res.status(404).json({ error: 'Manifest not found' });
    res.json(manifest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/manifest
 * body: { routeDate, stops: [{ trackingNumber, address }] }
 * Geocodes/dedupes every address through the shared Address cache,
 * then stores the manifest in its as-uploaded order.
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const { routeDate, stops } = req.body;
    if (!routeDate || !Array.isArray(stops) || !stops.length) {
      return res.status(400).json({ error: 'routeDate and a non-empty stops array are required' });
    }

    const resolvedStops = [];
    for (let i = 0; i < stops.length; i++) {
      const addr = await getOrGeocodeAddress(stops[i].address);
      resolvedStops.push({
        address: addr._id,
        trackingNumber: stops[i].trackingNumber || '',
        manifestPosition: i,
        status: 'pending'
      });
    }

    const manifest = await Manifest.create({
      driver: req.user.sub,
      routeDate,
      stops: resolvedStops,
      status: 'uploaded'
    });

    const populated = await Manifest.findById(manifest._id).populate('stops.address');
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/manifest/:id/suggest
 * Returns a suggested stop order using the driver's learned RouteEdge graph.
 * With no history yet (your case, day one), every stop falls back to its
 * original manifest order — there is nothing to learn from until routes
 * start getting completed.
 */
router.get('/:id/suggest', requireAuth, async (req, res) => {
  const manifest = await Manifest.findById(req.params.id).populate('stops.address');
  if (!manifest) return res.status(404).json({ error: 'Manifest not found' });

  const edges = await RouteEdge.find({ driver: req.user.sub }).lean();
  const edgeWeight = new Map(); // `${from}_${to}` -> timesRun
  edges.forEach((e) => edgeWeight.set(`${e.fromAddress}_${e.toAddress}`, e.timesRun));

  const stopIds = manifest.stops.map((s) => String(s.address._id));
  const remaining = new Set(stopIds);
  const ordered = [];

  // Seed with the stop that has no known predecessor among today's stops,
  // or just the first uploaded stop if there's no graph data at all.
  let current = stopIds[0];
  ordered.push(current);
  remaining.delete(current);

  while (remaining.size) {
    // Prefer the highest-weight known edge from `current` to a remaining stop.
    let next = null;
    let bestWeight = -1;
    for (const candidate of remaining) {
      const w = edgeWeight.get(`${current}_${candidate}`) || 0;
      if (w > bestWeight) {
        bestWeight = w;
        next = candidate;
      }
    }
    // No learned edge at all (bestWeight stayed 0) -> fall back to nearest
    // by straight-line distance. (Left as a TODO hook: swap in real
    // haversine distance against Address.location once this matters —
    // with zero history right now, uploaded order is the only signal.)
    if (bestWeight <= 0) {
      next = [...remaining][0];
    }
    ordered.push(next);
    remaining.delete(next);
    current = next;
  }

  // Map manifest stops in suggested sequence
  const orderedStops = [];
  for (const stopId of ordered) {
    const s = manifest.stops.find((st) => String(st.address && (st.address._id || st.address)) === stopId);
    if (s) orderedStops.push(s);
  }
  for (const s of manifest.stops) {
    const sId = String(s.address && (s.address._id || s.address));
    if (!ordered.includes(sId)) orderedStops.push(s);
  }

  res.json({ suggestedOrder: ordered, stops: orderedStops, hasLearnedData: edges.length > 0 });
});

/**
 * PATCH /api/manifest/:id/reorder
 * body: { stops: [...] }
 * Saves updated stop sequencing before starting the route.
 */
router.patch('/:id/reorder', requireAuth, async (req, res) => {
  try {
    const { stops } = req.body;
    const manifest = await Manifest.findById(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'Manifest not found' });

    if (Array.isArray(stops)) {
      manifest.stops = stops;
    }
    if (manifest.status === 'uploaded') {
      manifest.status = 'sequenced';
    }
    await manifest.save();
    const updated = await Manifest.findById(req.params.id).populate('stops.address');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/manifest/:id/stop/:index
 * body: { status: 'delivered'|'skipped'|'pending', notes: string, gateCode?: string }
 * Updates stop delivery status and optional address notes / gateCode.
 */
router.patch('/:id/stop/:index', requireAuth, async (req, res) => {
  try {
    const { status, notes, gateCode } = req.body;
    const manifest = await Manifest.findById(req.params.id);
    if (!manifest) return res.status(404).json({ error: 'Manifest not found' });

    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0 || idx >= manifest.stops.length) {
      return res.status(400).json({ error: 'Invalid stop index' });
    }

    const stop = manifest.stops[idx];
    if (status) {
      stop.status = status;
      if (status === 'delivered') {
        stop.completedAt = new Date();
      }
    }
    if (notes !== undefined) stop.notes = notes;

    if (manifest.status === 'uploaded' || manifest.status === 'sequenced') {
      manifest.status = 'in_progress';
    }
    await manifest.save();

    if (gateCode !== undefined) {
      const Address = require('../models/Address');
      await Address.findByIdAndUpdate(stop.address, {
        gateCode,
        isGated: !!gateCode
      });
    }

    const updated = await Manifest.findById(req.params.id).populate('stops.address');
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/manifest/:id/complete
 * body: { finalOrder: [addressId, addressId, ...] }
 * Records the driver's actual final sequence and upserts RouteEdge weights
 * for every consecutive pair. This is the ONLY place learning happens.
 */
router.post('/:id/complete', requireAuth, async (req, res) => {
  const { finalOrder } = req.body;
  const manifest = await Manifest.findById(req.params.id);
  if (!manifest) return res.status(404).json({ error: 'Manifest not found' });

  finalOrder.forEach((addressId, idx) => {
    const stop = manifest.stops.find((s) => String(s.address) === String(addressId));
    if (stop) {
      stop.finalPosition = idx;
      stop.completedAt = new Date();
    }
  });
  manifest.status = 'completed';
  await manifest.save();

  for (let i = 0; i < finalOrder.length - 1; i++) {
    await RouteEdge.findOneAndUpdate(
      { driver: req.user.sub, fromAddress: finalOrder[i], toAddress: finalOrder[i + 1] },
      { $inc: { timesRun: 1 }, $set: { lastRunAt: new Date() } },
      { upsert: true }
    );
  }

  res.json({ ok: true });
});

module.exports = router;
