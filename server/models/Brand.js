const mongoose = require('mongoose');

/**
 * Single source of truth for brand/tracking-prefix lookups.
 *
 * BarcodeTool's "Brand Finder" and RoutingAssistant both had their own
 * copy of this concept. This is the one that survives — both apps should
 * be repointed to query this collection instead of their own.
 */
const brandSchema = new mongoose.Schema(
  {
    brandName: { type: String, required: true },
    trackingPrefix: { type: String, required: true, unique: true, index: true, uppercase: true, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Brand', brandSchema);
