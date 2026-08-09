require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');

const MONGODB_URI = process.env.MONGODB_URI;

const clientSchema = new mongoose.Schema({ id: String, name: String, phone: String }, { strict: false });
const bookingSchema = new mongoose.Schema({ id: String, clientPhone: String, clientName: String }, { strict: false });

const Client = mongoose.model('Client', clientSchema);
const Booking = mongoose.model('Booking', bookingSchema);

async function fix() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected!');

    const dbFile = JSON.parse(fs.readFileSync('db.json', 'utf8'));
    
    // Build a map of name to real phone
    const nameToPhone = {};
    const extractPhones = (obj) => {
        if (!obj) return;
        if (Array.isArray(obj)) {
            obj.forEach(extractPhones);
        } else if (typeof obj === 'object') {
            if (obj.name && obj.phone && typeof obj.phone === 'string' && !obj.phone.includes('*')) {
                nameToPhone[obj.name.toLowerCase()] = obj.phone;
            }
            if (obj.clientName && obj.clientPhone && typeof obj.clientPhone === 'string' && !obj.clientPhone.includes('*')) {
                nameToPhone[obj.clientName.toLowerCase()] = obj.clientPhone;
            }
            Object.values(obj).forEach(extractPhones);
        }
    };
    extractPhones(dbFile);
    console.log("Found real phones for:", Object.keys(nameToPhone).length, "names");

    // Fix Clients in MongoDB
    const corruptedClients = await Client.find({ phone: { $regex: '\\*' } });
    console.log(`Found ${corruptedClients.length} corrupted clients in DB`);
    for (let c of corruptedClients) {
        if (c.name && nameToPhone[c.name.toLowerCase()]) {
            c.phone = nameToPhone[c.name.toLowerCase()];
            await c.save();
            console.log(`Fixed client ${c.name} -> ${c.phone}`);
        } else {
            console.log(`Could not find real phone for client: ${c.name}`);
        }
    }

    // Fix Bookings in MongoDB
    const corruptedBookings = await Booking.find({ clientPhone: { $regex: '\\*' } });
    console.log(`Found ${corruptedBookings.length} corrupted bookings in DB`);
    for (let b of corruptedBookings) {
        if (b.clientName && nameToPhone[b.clientName.toLowerCase()]) {
            b.clientPhone = nameToPhone[b.clientName.toLowerCase()];
            await b.save();
            console.log(`Fixed booking for ${b.clientName} -> ${b.clientPhone}`);
        }
    }

    console.log('Fix complete!');
    process.exit(0);
}

fix().catch(err => {
    console.error(err);
    process.exit(1);
});
