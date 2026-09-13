const mongoose = require('mongoose');

const stopSchema = new mongoose.Schema(
  {
    address: { type: mongoose.Schema.Types.ObjectId, ref: 'Address', required: true },
    trackingNumber: String,
    // Position in the ORIGINAL uploaded manifest (before any sequencing)
    manifestPosition: Number,
    // Position after the driver's finalized run — null until the route is completed
    finalPosition: { type: Number, default: null },
    status: { type: String, enum: ['pending', 'delivered', 'skipped'], default: 'pending' },
    notes: String,
    completedAt: Date
  },
  { _id: false }
);

const manifestSchema = new mongoose.Schema(
  {
    driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    routeDate: { type: Date, required: true },
    stops: [stopSchema],
    status: { type: String, enum: ['uploaded', 'sequenced', 'in_progress', 'completed'], default: 'uploaded' }
  },
  { timestamps: true }
);

manifestSchema.index({ driver: 1, routeDate: 1 });

module.exports = mongoose.model('Manifest', manifestSchema);
