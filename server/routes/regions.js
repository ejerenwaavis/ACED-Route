const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const CATALOG_PATH = path.join(__dirname, '../data/regions.json');

function getCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    return { regions: [] };
  }
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

// GET /api/regions — Returns the active catalog of all available offline regions
router.get('/', (req, res) => {
  try {
    const catalog = getCatalog();
    res.json(catalog);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load regions catalog: ' + err.message });
  }
});

// GET /api/regions/:id — Returns metadata for a specific region
router.get('/:id', (req, res) => {
  try {
    const catalog = getCatalog();
    const region = catalog.regions.find((r) => r.id === req.params.id);
    if (!region) {
      return res.status(404).json({ error: `Region ${req.params.id} not found` });
    }
    res.json(region);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/regions/detect — Auto-detects matching region from driver GPS or manifest stops
router.post('/detect', (req, res) => {
  try {
    const { lat, lng, stops } = req.body;
    const catalog = getCatalog();

    let targetLat = lat;
    let targetLng = lng;

    // If a list of stops was supplied, compute centroid
    if ((!targetLat || !targetLng) && Array.isArray(stops) && stops.length > 0) {
      let sumLat = 0;
      let sumLng = 0;
      let validCount = 0;

      for (const stop of stops) {
        const coords = stop.address?.location?.coordinates || stop.coordinates;
        if (coords && coords.length >= 2) {
          // Mongo coordinates are [lng, lat]
          const cLng = coords[0];
          const cLat = coords[1];
          sumLat += cLat;
          sumLng += cLng;
          validCount++;
        }
      }

      if (validCount > 0) {
        targetLat = sumLat / validCount;
        targetLng = sumLng / validCount;
      }
    }

    // Match against region bounds if coordinates available
    let matched = null;
    if (targetLat != null && targetLng != null) {
      matched = catalog.regions.find((r) => {
        const b = r.bounds;
        if (!b) return false;
        return (
          targetLat >= b.minLat &&
          targetLat <= b.maxLat &&
          targetLng >= b.minLng &&
          targetLng <= b.maxLng
        );
      });
    }

    // Match against address state code if supplied
    if (!matched && Array.isArray(stops) && stops.length > 0) {
      const states = stops.map(s => (s.address?.state || s.state || '').toUpperCase().trim()).filter(Boolean);
      if (states.some(st => st === 'GA' || st.includes('GEORGIA'))) {
        matched = catalog.regions.find(r => r.id === 'us-ga-metro');
      } else if (states.some(st => st === 'NY' || st.includes('NEW YORK'))) {
        matched = catalog.regions.find(r => r.id === 'us-ny-metro');
      } else if (states.some(st => st === 'DC' || st === 'MD' || st === 'VA')) {
        matched = catalog.regions.find(r => r.id === 'us-dc');
      }
    }

    if (matched) {
      return res.json({
        matched: true,
        region: matched,
        targetCoordinates: targetLat != null && targetLng != null ? [targetLat, targetLng] : null
      });
    }

    // If not within specific bounding box, fallback to default sample-metro or first region
    const fallback = catalog.regions.find((r) => r.id === 'sample-metro') || catalog.regions[0];
    res.json({
      matched: false,
      region: fallback,
      targetCoordinates: [targetLat, targetLng],
      message: 'No exact bounding box match found. Suggested fallback region provided.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
