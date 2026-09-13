const mongoose = require('mongoose');

/**
 * The learned-sequencing graph, per driver.
 *
 * Every time a manifest is marked `completed`, walk its finalized stop
 * order and upsert an edge for each consecutive pair (fromAddress ->
 * toAddress), incrementing `timesRun`. Suggesting a route for a new
 * manifest = for each known address, look up its highest-weight edges
 * and chain them; addresses with no edge yet fall back to nearest-
 * neighbor insertion against `Address.location`.
 *
 * This starts empty for you right now — there's no historical Mongo
 * data to seed it with. It builds itself from the first completed route
 * onward.
 */
const routeEdgeSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fromAddress: { type: mongoose.Schema.Types.ObjectId, ref: 'Address', required: true },
    toAddress: { type: mongoose.Schema.Types.ObjectId, ref: 'Address', required: true },
    timesRun: { type: Number, default: 1 },
    lastRunAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

routeEdgeSchema.index({ driver: 1, fromAddress: 1, toAddress: 1 }, { unique: true });

module.exports = mongoose.model('RouteEdge', routeEdgeSchema);
