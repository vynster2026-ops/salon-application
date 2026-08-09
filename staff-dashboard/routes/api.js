const express = require('express');
const router = express.Router();
const Staff = require('../models/Staff');
const Client = require('../models/Client');
const Service = require('../models/Service');

// --- STAFF ROUTES ---
router.get('/staff', async (req, res) => {
  try {
    const staff = await Staff.find();
    // Convert array of objects to key-value map as expected by frontend
    const staffMap = {};
    staff.forEach(s => {
      staffMap[s.staffId] = s.toObject();
    });
    res.json(staffMap);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/staff', async (req, res) => {
  try {
    const newStaff = new Staff(req.body);
    const saved = await newStaff.save();
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/staff/:id', async (req, res) => {
  try {
    const updated = await Staff.findOneAndUpdate(
      { staffId: req.params.id }, 
      req.body, 
      { new: true, upsert: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CLIENT ROUTES ---
router.get('/clients', async (req, res) => {
  try {
    const clients = await Client.find();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients', async (req, res) => {
  try {
    const newClient = new Client(req.body);
    const saved = await newClient.save();
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SERVICE ROUTES ---
router.get('/services', async (req, res) => {
  try {
    const services = await Service.find();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
