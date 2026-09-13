const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true },
    name: String,
    photoUrl: String,
    role: { type: String, enum: ['driver', 'dispatcher', 'admin'], default: 'driver' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
