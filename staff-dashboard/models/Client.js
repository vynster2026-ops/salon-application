const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  lastVisit: String,
  visits: Number,
  totalSpent: Number,
  upcoming: String
}, { timestamps: true });

module.exports = mongoose.model('Client', clientSchema);
