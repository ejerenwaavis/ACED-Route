const mongoose = require('mongoose');

/**
 * Canonical address record.
 *
 * This is the ONE address table for every ACED app (BarcodeTool, SmartStop,
 * RoutingAssistant, ACED Route). Geocode an address once, store it here
 * forever, and every app looks it up by `normalizedAddress` instead of
 * re-geocoding or keeping its own copy.
 *
 * normalizedAddress = lowercase, punctuation-stripped, whitespace-collapsed
 * version of the raw string, used as the dedupe key across all apps.
 */
const addressSchema = new mongoose.Schema(
  {
    raw: { type: String, required: true },
    normalizedAddress: { type: String, required: true, unique: true, index: true },

    street: String,
    city: String,
    state: String,
    postalCode: String,
    country: { type: String, default: 'US' },

    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: undefined } // [lng, lat]
    },

    // Gate code / access info — ported from SmartStop's use case.
    isGated: { type: Boolean, default: false },
    gateCode: String,

    // Free-form driver notes that accumulate over time (parking, dogs, etc.)
    notes: String,

    geocodeSource: { type: String, default: 'google' },
    geocodedAt: Date
  },
  { timestamps: true }
);

addressSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Address', addressSchema);
