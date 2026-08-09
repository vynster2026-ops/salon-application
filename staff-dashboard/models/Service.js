const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  category: { type: String, required: true }, // 'indoor' or 'outdoor'
  duration: Number
}, { timestamps: true });

module.exports = mongoose.model('Service', serviceSchema);
