const express = require('express');
const Brand = require('../models/Brand');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// Same prefix-match concept BarcodeTool used, now against the one shared collection.
router.get('/find/:tracking', requireAuth, async (req, res) => {
  const prefix = req.params.tracking.toUpperCase().substring(0, 7);
  const match = await Brand.findOne({ trackingPrefix: prefix });
  res.json({ brand: match ? match.brandName : null });
});

router.post('/', requireAuth, async (req, res) => {
  const { brandName, trackingPrefix } = req.body;
  if (!brandName || !trackingPrefix) {
    return res.status(400).json({ error: 'brandName and trackingPrefix are required' });
  }
  const brand = await Brand.findOneAndUpdate(
    { trackingPrefix: trackingPrefix.toUpperCase() },
    { brandName },
    { upsert: true, new: true }
  );
  res.json(brand);
});

module.exports = router;
