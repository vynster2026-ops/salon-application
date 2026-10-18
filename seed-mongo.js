require('dotenv').config();
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}
const mongoose = require('mongoose');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/medhikaarts';

const clientSchema = new mongoose.Schema({ id: String, name: String, phone: String, email: String, location: String, pts: Number, ltv: String, av: String }, { strict: false });
const staffSchema = new mongoose.Schema({ id: String, name: String, gender: String, spec: String, rating: String, av: String, services: [String], status: String, attendance: Array, performanceScore: Number, hireDate: String, alerts: Array, commissionRate: Object, retentionRate: String }, { strict: false });
const serviceSchema = new mongoose.Schema({ id: String, name: String, cat: String, duration: Number, price: Number, prices: [Number], icon: String, gender: String }, { strict: false });
const inventorySchema = new mongoose.Schema({ id: String, name: String, cat: String, stock: Number, min: Number, unit: String, cost: Number }, { strict: false });
const bookingSchema = new mongoose.Schema({ id: String, clientId: String, clientName: String, services: [String], staffId: mongoose.Schema.Types.Mixed, additionalStaff: Array, date: String, time: String, total: Number, status: String, notes: String, source: String, location: String, deposit: Boolean, timestamp: String }, { strict: false });
const eventSchema = new mongoose.Schema({ id: String, title: String, date: String, time: String, type: String, description: String }, { strict: false });
const expenseSchema = new mongoose.Schema({ id: String, cat: String, desc: String, amount: Number, date: String, method: String }, { strict: false });
const campaignSchema = new mongoose.Schema({ id: String, name: String, message: String, mediaUrls: [String], recipientsCount: Number, status: String, timestamp: String, results: Array }, { strict: false });

const branchSchema = new mongoose.Schema({ id: String, name: String, location: String, phone: String, chainId: String, email: String, accessKey: String, password: String, status: String, verificationStatus: String }, { strict: false });
const adminSchema = new mongoose.Schema({ email: String, password: String, name: String, role: String, tier: Number, status: String }, { strict: false });
const chainSchema = new mongoose.Schema({ id: String, name: String, logo: String, color: String }, { strict: false });

const Client = mongoose.model('Client', clientSchema);
const Staff = mongoose.model('Staff', staffSchema);
const Service = mongoose.model('Service', serviceSchema);
const Inventory = mongoose.model('Inventory', inventorySchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Event = mongoose.model('Event', eventSchema);
const Expense = mongoose.model('Expense', expenseSchema);
const Campaign = mongoose.model('Campaign', campaignSchema);
const Branch = mongoose.model('Branch', branchSchema);
const Admin = mongoose.model('Admin', adminSchema);
const Chain = mongoose.model('Chain', chainSchema);

async function seed() {
    console.log('Connecting to MongoDB...');
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('Connected to MongoDB successfully!');

        const dbFile = JSON.parse(fs.readFileSync('db.json', 'utf8'));

        console.log(`Found:
  - ${dbFile.branches ? dbFile.branches.length : 0} branches/salons
  - ${dbFile.admins ? dbFile.admins.length : 0} admins
  - ${dbFile.clients ? dbFile.clients.length : 0} clients
  - ${dbFile.bookings ? dbFile.bookings.length : 0} bookings
  - ${dbFile.staff ? dbFile.staff.length : 0} staff`);

        console.log('Clearing old data in MongoDB...');
        await Promise.all([
            Client.deleteMany({}),
            Staff.deleteMany({}),
            Service.deleteMany({}),
            Inventory.deleteMany({}),
            Booking.deleteMany({}),
            Event.deleteMany({}),
            Expense.deleteMany({}),
            Campaign.deleteMany({}),
            Branch.deleteMany({}),
            Admin.deleteMany({}),
            Chain.deleteMany({})
        ]);

        console.log('Inserting local data into MongoDB...');
        if (dbFile.branches && dbFile.branches.length) await Branch.insertMany(dbFile.branches);
        if (dbFile.admins && dbFile.admins.length) await Admin.insertMany(dbFile.admins);
        if (dbFile.chains && dbFile.chains.length) await Chain.insertMany(dbFile.chains);
        if (dbFile.clients && dbFile.clients.length) await Client.insertMany(dbFile.clients);
        if (dbFile.staff && dbFile.staff.length) await Staff.insertMany(dbFile.staff);
        if (dbFile.services && dbFile.services.length) await Service.insertMany(dbFile.services);
        if (dbFile.inventory && dbFile.inventory.length) await Inventory.insertMany(dbFile.inventory);
        if (dbFile.bookings && dbFile.bookings.length) await Booking.insertMany(dbFile.bookings);
        if (dbFile.events && dbFile.events.length) await Event.insertMany(dbFile.events);
        if (dbFile.expenses && dbFile.expenses.length) await Expense.insertMany(dbFile.expenses);
        if (dbFile.campaigns && dbFile.campaigns.length) await Campaign.insertMany(dbFile.campaigns);

        console.log('Data migration complete! All branches, admins, bookings, and salon data successfully imported into MongoDB.');
        process.exit(0);
    } catch (err) {
        console.error('Error during migration:', err);
        process.exit(1);
    }
}

seed();
