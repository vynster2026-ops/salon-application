const mongoose = require('mongoose');
const fs = require('fs');

// Connect to MongoDB
const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/salon';
mongoose.connect(mongoURI)
  .then(() => console.log('Successfully connected to MongoDB for migration'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Models
const Staff = require('./models/Staff');
const Client = require('./models/Client');
const Service = require('./models/Service');

// Read data.js and safely parse the content
const dataJs = fs.readFileSync('./data.js', 'utf8');

// A simple way to evaluate data.js into our current context without crashing
// We will extract the global objects.
const sandbox = {
  console: console,
  generateAppointments: null,
  STAFF_DATA: {},
  SERVICES_MENU: [],
  FALLBACK_CLIENTS: [],
  window: {},
  localStorage: {
    getItem: () => null,
    setItem: () => {}
  }
};

// We create a mock environment to run the data.js code
const vm = require('vm');
try {
  vm.createContext(sandbox);
  // Export the const variables to the sandbox
  const exportScript = `
    window.STAFF_DATA = STAFF_DATA;
    window.SERVICES_MENU = SERVICES_MENU;
    window.FALLBACK_CLIENTS = FALLBACK_CLIENTS;
  `;
  vm.runInContext(dataJs + exportScript, sandbox);
} catch (e) {
  console.log("Could not fully evaluate data.js, attempting partial extraction", e.message);
}

const STAFF_DATA = sandbox.window.STAFF_DATA;
const SERVICES_MENU = sandbox.window.SERVICES_MENU;
const FALLBACK_CLIENTS = sandbox.window.FALLBACK_CLIENTS;

async function runMigration() {
  try {
    console.log('--- Starting Data Migration ---');

    // 1. Migrate Staff Data
    if (STAFF_DATA && Object.keys(STAFF_DATA).length > 0) {
      console.log('Clearing old staff data...');
      await Staff.deleteMany({});
      
      const staffDocs = [];
      for (const [key, value] of Object.entries(STAFF_DATA)) {
        staffDocs.push({
          staffId: key,
          ...value
        });
      }
      
      await Staff.insertMany(staffDocs);
      console.log(`Successfully inserted ${staffDocs.length} staff records.`);
    }

    // 2. Migrate Client Data
    if (FALLBACK_CLIENTS && FALLBACK_CLIENTS.length > 0) {
      console.log('Clearing old client data...');
      await Client.deleteMany({});
      await Client.insertMany(FALLBACK_CLIENTS);
      console.log(`Successfully inserted ${FALLBACK_CLIENTS.length} client records.`);
    }

    // 3. Migrate Service Data
    if (SERVICES_MENU && SERVICES_MENU.length > 0) {
      console.log('Clearing old service data...');
      await Service.deleteMany({});
      
      // SERVICES_MENU has 'category', 'services'
      const serviceDocs = [];
      SERVICES_MENU.forEach(cat => {
        cat.services.forEach(svc => {
          serviceDocs.push({
            id: svc.id,
            name: svc.name,
            price: svc.price,
            category: cat.category,
            duration: svc.duration || 30 // Fallback duration
          });
        });
      });
      
      await Service.insertMany(serviceDocs);
      console.log(`Successfully inserted ${serviceDocs.length} service records.`);
    }

    console.log('--- Migration Completed Successfully ---');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

// Allow connection to establish before running
setTimeout(runMigration, 1000);
