const mongoose = require('mongoose');

const hospitalSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  emailFrom: {
    type: String,
  }, // Hospital sender email

  smtp: {
    host: String,
    port: Number,
    secure: Boolean,
    auth: {
      user: String,
      pass: String
    }
  },

  // ✅ Add these fields for admin login
  adminEmail: {
    type: String,
    required: true,
    unique: true
  },
  adminPasswordHash: {
    type: String,
    required: true
  }
});

// For geospatial queries (like nearest hospital)
hospitalSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Hospital', hospitalSchema);
