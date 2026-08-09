require('dotenv').config();
const express = require('express');
const cors = require('cors');
const twilio = require('twilio');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the current directory, but disable default index.html serving
app.use(express.static(__dirname, { index: false }));

// MongoDB Connection Setup
const mongoose = require('mongoose');
const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/salon';
mongoose.connect(mongoURI)
  .then(() => console.log('Successfully connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Use API Routes
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

// Set default route to show login page
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/login.html');
});

const PORT = 3000;

// Initialize Twilio client using dummy/placeholder keys if not configured
const accountSid = process.env.TWILIO_ACCOUNT_SID || 'dummy_sid';
const authToken = process.env.TWILIO_AUTH_TOKEN || 'dummy_token';
const twilioPhone = process.env.TWILIO_PHONE_NUMBER || 'dummy_number';

// We'll catch initialization errors so the server still runs if keys are fake
let client;
try {
  client = twilio(accountSid, authToken);
} catch (e) {
  console.warn("Twilio client failed to initialize (invalid or placeholder keys)");
}

// In-memory store for OTPs (in production, use Redis or a database)
const otps = {};

app.post('/api/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Generate 4-digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();
  
  // Save OTP in memory temporarily
  otps[phone] = otp;

  console.log(`Generated OTP for ${phone}: ${otp}`);

  // If we have valid Twilio config, send it
  if (client && accountSid !== 'your_account_sid_here') {
    try {
      await client.messages.create({
        body: `Your Srijes Salon verification OTP is: ${otp}`,
        from: twilioPhone,
        to: `+91${phone}` // Assuming Indian number layout as per placeholder 98765 XXXXX
      });
      return res.json({ success: true, message: 'OTP sent successfully' });
    } catch (err) {
      console.error('Error sending SMS via Twilio:', err.message);
      return res.status(500).json({ error: 'Failed to send SMS through Twilio. Please check your API keys and configuration.' });
    }
  } else {
    // If not configured, just return success so the frontend continues,
    // and log the OTP so the developer can see it
    console.log(`[Twilio Not Configured] Would have sent SMS to ${phone} with OTP: ${otp}`);
    return res.json({ success: true, message: 'OTP logged to server console (Twilio not configured)', mock: true, otp: otp });
  }
});

app.post('/api/verify-otp', (req, res) => {
  const { phone, otp } = req.body;
  
  if (!phone || !otp) {
    return res.status(400).json({ error: 'Phone and OTP are required' });
  }

  if (otps[phone] === otp) {
    // OTP verified successfully
    delete otps[phone]; // Clean up
    return res.json({ success: true, message: 'OTP verified' });
  } else {
    return res.status(400).json({ error: 'Invalid OTP' });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log('To send real SMS, update the .env file with your Twilio API credentials.');
});
