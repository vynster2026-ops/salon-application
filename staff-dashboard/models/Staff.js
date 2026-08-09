const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  id: String,
  time: String,
  client: String,
  service: String,
  duration: Number,
  price: Number,
  status: String,
  phone: String,
  notes: String
});

const reviewSchema = new mongoose.Schema({
  client: String,
  initials: String,
  rating: Number,
  comment: String,
  service: String,
  date: String
});

const leaveSchema = new mongoose.Schema({
  type: String,
  from: String,
  to: String,
  reason: String,
  status: String
});

const staffSchema = new mongoose.Schema({
  staffId: { type: String, required: true, unique: true }, // 'priya', 'amit', etc.
  name: String,
  role: String,
  avatar: String,
  phone: String,
  email: String,
  joinDate: String,
  shift: String,
  status: String,
  rating: Number,
  completedToday: Number,
  todayAppointments: Number,
  earnedRevenue: Number,
  avgServiceTime: Number,
  clientReturnRate: Number,
  attendance: Number,
  currentClient: String,
  nextClient: String,
  nextTime: String,
  specialties: [String],
  weeklyRevenue: [Number],
  weeklyServices: [Number],
  appointments: [appointmentSchema],
  reviews: [reviewSchema],
  leaves: [leaveSchema]
}, { timestamps: true });

module.exports = mongoose.model('Staff', staffSchema);
