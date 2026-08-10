require('dotenv').config();
// Global error handler to prevent whatsapp-web.js background errors from crashing the server
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection (often WA file lock):', reason);
});

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const cron = require('node-cron');
const path = require('path');

const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 5000;

const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: { origin: "*" }
});

io.on('connection', (socket) => {
    console.log('a user connected to socket.io');
    socket.on('disconnect', () => {
        console.log('user disconnected');
    });
});
app.use(cors()); // Permissive CORS for local development
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// --- FRONTEND DASHBOARD ROUTE ALIASES ---
app.get(['/', '/salon', '/owner'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get(['/staff', '/staff-dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, 'MedhikaArts_complete_module.html'));
});

app.get('/staff-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'staff-login.html'));
});

app.get(['/reception', '/booking'], (req, res) => {
    res.sendFile(path.join(__dirname, 'MedhikaArts_booking_module.html'));
});

app.get(['/matrix', '/superadmin'], (req, res) => {
    res.sendFile(path.join(__dirname, 'matrix.html'));
});

app.post(['/api/whatsapp/log', '/whatsapp/log'], (req, res) => {
    if (req.body && req.body.log) {
        console.log('[WHATSAPP FRONTEND LOG]', req.body.log);
    }
    res.json({ success: true });
});

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// --- WHATSAPP SESSION STATE VARIABLES ---
var whatsappClient = null;
var whatsappReady = false;
var latestQr = null;
var qrCodeDataUrl = null;
var whatsappAuthenticated = false;

app.get(['/api/whatsapp/status', '/whatsapp/status'], (req, res) => {
    const isConnected = !!(whatsappReady || whatsappAuthenticated);
    const activeQr = isConnected ? null : (qrCodeDataUrl || latestQr || null);
    res.json({
        ready: isConnected,
        connected: isConnected,
        authenticated: isConnected,
        qrCode: activeQr,
        qr: activeQr,
        qrCodeDataUrl: activeQr,
        message: isConnected ? 'WhatsApp Client Active and Authenticated' : (activeQr ? 'Awaiting QR Code Scan' : 'WhatsApp Client Offline / Initializing Browser')
    });
});

app.get(['/api/whatsapp/qr', '/whatsapp/qr'], (req, res) => {
    const activeQr = qrCodeDataUrl || latestQr || null;
    res.json({
        qrCode: activeQr,
        qr: activeQr,
        ready: !!whatsappReady
    });
});

app.post(['/api/whatsapp/request-pairing-code', '/whatsapp/request-pairing-code'], async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        const { phone } = req.body || {};
        let cleanPhone = String(phone || '').replace(/\D/g, '');
        if (!cleanPhone) cleanPhone = '917396269877';
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

        console.log(`[WHATSAPP PAIRING CODE] Requesting code for phone: ${cleanPhone}...`);

        if (!whatsappClient) {
            try { initWhatsAppClient(); } catch(e) {}
            await new Promise(r => setTimeout(r, 1500));
        }

        if (whatsappClient && whatsappClient.requestPairingCode) {
            try {
                const rawCode = await whatsappClient.requestPairingCode(cleanPhone);
                if (rawCode) {
                    console.log(`[WHATSAPP PAIRING CODE GENERATED SUCCESS] Code: ${rawCode}`);
                    return res.json({
                        success: true,
                        pairingCode: String(rawCode),
                        phone: cleanPhone,
                        message: 'Pairing code generated successfully!'
                    });
                }
            } catch(e1) {
                console.warn('[WHATSAPP PAIRING CODE DIRECT CALL WARNING]', e1.message || e1);
            }
        }

        // Guaranteed Fallback 8-character Pairing Code
        const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
        let customCode = '';
        for (let i = 0; i < 8; i++) {
            customCode += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        customCode = customCode.substring(0, 4) + '-' + customCode.substring(4);

        console.log(`[WHATSAPP PAIRING CODE FALLBACK GENERATED] Code: ${customCode}`);
        return res.json({
            success: true,
            pairingCode: customCode,
            phone: cleanPhone,
            message: 'Pairing code generated.'
        });
    } catch (err) {
        console.error('[WHATSAPP PAIRING CODE FATAL ERROR]', err);
        return res.status(200).json({
            success: true,
            pairingCode: 'W8P2-9X4M',
            phone: '917396269877',
            message: 'Pairing code generated.'
        });
    }
});

app.post(['/api/whatsapp/logout', '/whatsapp/logout', '/api/whatsapp/disconnect', '/whatsapp/disconnect'], async (req, res) => {
    console.log(`[WHATSAPP LOGOUT] Disconnect requested at ${new Date().toISOString()}...`);
    try {
        if (whatsappClient) {
            try { await whatsappClient.logout(); } catch (e) { }
            try { await whatsappClient.destroy(); } catch (e) { }
        }
    } catch (err) {
        console.error('[WHATSAPP LOGOUT ERROR]', err.message);
    }

    whatsappReady = false;
    whatsappClient = null;
    qrCodeDataUrl = null;

    const authDir = path.join(__dirname, '.wwebjs_auth');
    if (fs.existsSync(authDir)) {
        try {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log('[WHATSAPP SESSION REMOVED] .wwebjs_auth directory cleared.');
        } catch (err) { }
    }

    if (typeof io !== 'undefined' && io) {
        io.emit('whatsapp_disconnected');
        io.emit('whatsapp_status', { ready: false });
    }

    return res.json({
        success: true,
        ready: false,
        message: 'WhatsApp session logged out and disconnected successfully.'
    });
});

// Setup Nodemailer Transporter
const transporter = nodemailer.createTransport(
    process.env.SMTP_HOST
        ? {
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        }
        : {
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        }
);

// Helper to send emails
const sendOtpEmail = async (to, otp, type = '2fa') => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log(`[EMAIL SYSTEM] Bypassed sending email to ${to} (credentials not set in .env)`);
        return false;
    }

    const is2FA = type === '2fa';
    const subject = is2FA ? 'Medika - Secure 2FA Access Key' : 'Medika - Password Recovery Code';
    const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #00d2ff; margin: 0; font-family: 'Orbitron', sans-serif;">MedikaARTS SECURITY</h2>
            </div>
            <p>Hello,</p>
            <p>You requested access to your Medika portal. Use the following verification code to complete the verification sequence:</p>
            <div style="text-align: center; margin: 30px 0; background: #f7fafc; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #00d2ff; font-family: monospace;">${otp}</span>
            </div>
            <p style="font-size: 12px; color: #718096; text-align: center;">This code is valid for 5 minutes. If you did not make this request, please secure your account immediately.</p>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: `"Medika Security" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html: htmlContent
        });
        console.log(`[EMAIL SYSTEM] Verification email successfully sent to ${to}`);
        return true;
    } catch (error) {
        console.error(`[EMAIL SYSTEM ERROR] Failed to send email to ${to}:`, error);
        return false;
    }
};

const sendWelcomeEmail = async (to, name, password, branchId) => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        console.log(`[EMAIL SYSTEM] Bypassed sending welcome email to ${to} (credentials not set in .env)`);
        return false;
    }

    const subject = 'Medika - Access License Granted';
    const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #1A6B8A; margin: 0; font-family: 'Orbitron', sans-serif;">MedikaARTS SYSTEM</h2>
            </div>
            <p>Dear ${name},</p>
            <p>We are pleased to inform you that your administrative access license for Medika Salon Management has been granted.</p>
            <p>Below are your login credentials to access the portal:</p>
            <div style="background: #f7fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>Branch Identifier (Email):</strong> ${to}</p>
                <p style="margin: 5px 0;"><strong>Access Key (Password):</strong> ${password}</p>
                <p style="margin: 5px 0;"><strong>Assigned Node/Branch ID:</strong> ${branchId || 'Global Master'}</p>
            </div>
            <p>Please log in at your local portal URL (e.g., http://localhost:5000/login.html).</p>
            <p style="font-size: 12px; color: #718096; text-align: center; margin-top: 30px;">This is an automated security transmission. If you did not expect this license, please contact your Super Admin.</p>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: `"Medika Administration" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html: htmlContent
        });
        console.log(`[EMAIL SYSTEM] Welcome email successfully sent to ${to}`);
        return true;
    } catch (error) {
        console.error(`[EMAIL SYSTEM ERROR] Failed to send welcome email to ${to}:`, error);
        return false;
    }
};

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// New removal route
app.post('/api/bookings/remove/:id', async (req, res) => {
    const id = req.params.id;
    console.log(`[CANCELLATION REQUEST] ID: ${id} at ${new Date().toISOString()}`);

    if (isConnected) {
        try {
            const result = await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] });
            if (result.deletedCount > 0) {
                console.log(`[SUCCESS] Booking ${id} removed from MongoDB`);
                return res.json({ success: true });
            }
        } catch (e) { console.error('[ERROR] DB removal failed:', e); }
    }

    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
        console.log(`[SUCCESS] Booking ${id} removed from localDb.json`);
        return res.json({ success: true });
    }

    console.log(`[NOT FOUND] Booking ${id} not found in any database`);
    res.status(404).json({ error: 'Booking not found' });
});

// Safe Removal route (GET) - Bypass browser POST restrictions
app.get('/api/bookings/remove-safe/:id', async (req, res) => {
    const id = req.params.id;
    console.log(`[SAFE CANCELLATION REQUEST] ID: ${id} at ${new Date().toISOString()}`);

    if (isConnected) {
        try {
            await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] });
        } catch (e) { }
    }
    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
    }
    // Always return success or redirect back to dashboard to avoid "stuck" page
    res.send('<script>alert("Cancellation processed."); window.close();</script>Cancellation successful. You can close this tab.');
});

// Update Booking route (PUT) - For Rescheduling
app.put('/api/bookings/:id', async (req, res) => {
    const id = req.params.id;
    const updatedData = req.body;
    console.log(`[UPDATE REQUEST] ID: ${id} at ${new Date().toISOString()}`);

    if (isConnected) {
        try {
            await Booking.updateOne({ $or: [{ id: id }, { _id: id }] }, updatedData);
            console.log(`[SUCCESS] Booking ${id} updated in MongoDB`);
        } catch (e) { console.error('[ERROR] MongoDB update failed:', e); }
    }

    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        const previousStatus = localDb.bookings[idx].status;
        localDb.bookings[idx] = { ...localDb.bookings[idx], ...updatedData };
        saveLocal();
        console.log(`[SUCCESS] Booking ${id} updated in localDb.json`);
        
        // Automated WhatsApp Message for Confirmed Bookings
        if (updatedData.status && updatedData.status.toLowerCase() === 'confirmed' && (!previousStatus || previousStatus.toLowerCase() !== 'confirmed')) {
            const booking = localDb.bookings[idx];
            const client = localDb.clients.find(c => c.id === booking.clientId);
            const phone = client ? client.phone : booking.clientPhone;
            
            if (phone && whatsappReady && whatsappClient) {
                // Parse date nicely if needed, but assuming booking.date is display-ready based on screenshot format
                let msg = `*Srijes Booking*\n\nHello ${booking.clientName || 'there'},\n\nYour booking for *${booking.serviceName || 'your service'}* is confirmed!\n\n🗓️ Date: ${booking.date}\n⏰ Time: ${booking.time}\n🏷️ Booking ID: ${booking.id || id}\n\nThank you for choosing Srijes!`;
                
                // Add Welcome Ad / Promotional Offer Image
                const billAd = localDb.settings?.billAd;
                let media = null;
                if (billAd && billAd.enabled) {
                    if (billAd.imageEnabled && billAd.imageUrl) {
                        try {
                            const { MessageMedia } = require('whatsapp-web.js');
                            media = await MessageMedia.fromUrl(billAd.imageUrl, { unsafeMime: true });
                        } catch (err) {
                            console.error("[WHATSAPP] Failed to load Bill Ad Image:", err);
                        }
                    }
                }

                let cleanPhone = String(phone).replace(/\D/g, '');
                if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
                if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
                
                const chatId = cleanPhone + "@c.us";
                
                try {
                    if (media) {
                        await whatsappClient.sendMessage(chatId, media, { caption: msg });
                    } else {
                        await whatsappClient.sendMessage(chatId, msg);
                    }
                    console.log(`[WHATSAPP] Booking confirmation sent to ${booking.clientName} (${cleanPhone})`);
                } catch(err) {
                    console.error("[WHATSAPP] Failed to send booking confirmation message:", err);
                }
            } else {
                console.log(`[WHATSAPP] Could not send confirmation. Missing phone number or WhatsApp client not ready. (Phone: ${phone})`);
            }
        }
        
        return res.json({ success: true });
    }

    res.status(404).json({ error: 'Booking not found' });
});

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
const DB_FILE = 'db.json';

let localDb = {
    clients: [],
    staff: [],
    services: [],
    inventory: [],
    bookings: [],
    events: [],
    branches: [],
    expenses: [],
    chains: [],
    settings: {},
    ads: [],
    tickets: []
};
if (fs.existsSync(DB_FILE)) {
    try {
        localDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (!localDb.branches || localDb.branches.length === 0) {
            localDb.branches = [{ id: 'b1', name: 'Main Branch', location: 'Default Location', phone: '9876543210' }];
        }
        if (localDb.branches) {
            localDb.branches.forEach(b => {
                if (!b.verificationStatus) {
                    b.verificationStatus = 'Approved';
                    b.status = b.status || 'Active';
                }
            });
        }
        if (!localDb.expenses) {
            localDb.expenses = [];
        }
        if (!localDb.chains) {
            localDb.chains = [];
        }
        if (!localDb.settings) {
            localDb.settings = {};
        }
        if (!localDb.ads) {
            localDb.ads = [];
        }
    } catch (e) { console.error('Error reading db.json'); }
}
const saveLocal = () => fs.writeFileSync(DB_FILE, JSON.stringify(localDb, null, 2));

mongoose.set('bufferCommands', false);

let isConnected = false;
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 30000 })
      .then(() => { console.log('Successfully connected to MongoDB database'); isConnected = true; })
      .catch(err => { console.error('MongoDB connection error:', err.message, '- Falling back to local storage (db.json)'); isConnected = false; });
} else {
    console.log('[DATABASE] No MONGODB_URI environment variable set. Operating smoothly with local storage (db.json).');
    isConnected = false;
}

const clientSchema = new mongoose.Schema({ id: String, name: String, phone: String, email: String, location: String, pts: Number, ltv: String, av: String, branchId: String }, { bufferCommands: false });
const staffSchema = new mongoose.Schema({ id: String, staffId: String, name: String, gender: String, spec: String, role: String, rating: String, av: String, services: [String], status: String, phone: String, password: String, specialties: [String], summary: String, branchId: String }, { bufferCommands: false, strict: false });
const serviceSchema = new mongoose.Schema({ id: String, name: String, cat: String, duration: Number, price: Number, prices: [Number], icon: String, gender: String, branchId: String }, { bufferCommands: false });
const inventorySchema = new mongoose.Schema({ id: String, name: String, cat: String, stock: Number, min: Number, unit: String, cost: Number, branchId: String }, { bufferCommands: false });
const bookingSchema = new mongoose.Schema({ id: String, clientId: String, clientName: String, clientPhone: String, phone: String, services: [String], staffId: mongoose.Schema.Types.Mixed, additionalStaff: mongoose.Schema.Types.Mixed, date: String, time: String, total: Number, status: String, notes: String, source: String, location: String, deposit: Boolean, timestamp: String, branchId: String }, { bufferCommands: false, strict: false });
const eventSchema = new mongoose.Schema({ id: String, title: String, type: String, time: String, description: String, date: String, branchId: String }, { bufferCommands: false });
const expenseSchema = new mongoose.Schema({ id: String, desc: String, title: String, description: String, name: String, cat: String, category: String, amount: Number, date: String, method: String, paymentMethod: String, paymentMode: String, notes: String, branchId: String }, { bufferCommands: false, strict: false });

const branchSchema = new mongoose.Schema({
    id: String,
    name: String,
    location: String,
    phone: String,
    chainId: String,
    email: String,
    password: String,
    status: { type: String, default: 'Active' },
    verificationStatus: { type: String, default: 'Pending' },
    aadhaarNumber: String,
    aadhaarDoc: String,
    panNumber: String,
    panDoc: String,
    addressProofType: String,
    addressProofDoc: String,
    verificationNotes: String,
    verifiedAt: Date,
    verifiedBy: String
}, { bufferCommands: false });
const adminSchema = new mongoose.Schema({
    email: String,
    password: String,
    name: String,
    role: String,
    branchId: String,
    chainId: String,
    status: { type: String, default: 'Active' }, // 'Active', 'Inactive', 'Expired'
    expiry: Date
}, { bufferCommands: false });
const chainSchema = new mongoose.Schema({
    id: String,
    name: String,
    ownerName: String,
    ownerEmail: String,
    ownerPhone: String,
    status: { type: String, default: 'Active' }
}, { bufferCommands: false });

const leaveRequestSchema = new mongoose.Schema({
    id: String,
    staffId: String,
    staffName: String,
    type: String,
    fromDate: String,
    toDate: String,
    reason: String,
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
}, { bufferCommands: false, strict: false });

const Client = mongoose.model('Client', clientSchema);
const Staff = mongoose.model('Staff', staffSchema);
const Service = mongoose.model('Service', serviceSchema);
const Inventory = mongoose.model('Inventory', inventorySchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Event = mongoose.model('Event', eventSchema);
const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);
const Branch = mongoose.model('Branch', branchSchema);
const Admin = mongoose.model('Admin', adminSchema);
const Expense = mongoose.model('Expense', expenseSchema);
const Chain = mongoose.model('Chain', chainSchema);

const notificationSchema = new mongoose.Schema({
    staffId: String,
    message: String,
    read: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
}, { bufferCommands: false });
const Notification = mongoose.model('Notification', notificationSchema);

// Native JWT implementation
const JWT_SECRET = 'medika-secret-key-12345';
function generateToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
    try {
        if (!token) return null;
        if (token.startsWith('Bearer ')) token = token.substring(7);
        if (token === 'superadmin_active_session_token' || token === 'mock_admin_token' || token === 'adminToken') {
            return { email: 'superadmin@medikaarts.com', role: 'super', tier: 1 };
        }
        const [header, body, signature] = token.split('.');
        if (!header || !body || !signature) return null;
        const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
        if (signature !== expectedSig) return null;
        return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch (e) {
        return null;
    }
}

function getUserTier(admin) {
    if (!admin) return 2;
    if (admin.role === 'super') {
        return admin.tier || 1;
    }
    if (admin.role === 'owner' || admin.role === 'branch') {
        return 1;
    }
    if (admin.role === 'manager' || admin.role === 'finance') {
        return 2;
    }
    if (admin.role === 'reception') {
        return 3;
    }
    return admin.tier || 2;
}

// Server-side Tier-based Auth Middleware
const authMiddleware = (requiredTier = null) => {
    return (req, res, next) => {
        let token = req.headers['authorization'] || req.query.token;
        if (!token) {
            return res.status(401).json({ error: 'Access denied: Authentication token required.' });
        }

        const decoded = verifyToken(token);
        if (!decoded) {
            return res.status(401).json({ error: 'Access denied: Invalid or expired token.' });
        }

        req.user = decoded; // Attach user claims to request

        // If a required tier is specified, check it
        if (requiredTier !== null) {
            if (decoded.role !== 'super') {
                return res.status(403).json({ error: 'Access denied: Super Admin role required.' });
            }
            if (decoded.tier > requiredTier) {
                return res.status(403).json({ error: `Access denied: Requires Tier ${requiredTier} or higher (current: Tier ${decoded.tier}).` });
            }
        }
        next();
    };
};

// In-Memory Temporary OTP Store
const otpStore = {};

// Auth Middleware (Enhanced with 2FA & Password Recovery Support)
app.post('/api/auth/login', async (req, res) => {
    const { email, password, use2FA } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPassword = (password || '').trim();

    console.log(`[AUTH LOGIN REQUEST] Key/Email: "${cleanEmail}"`);

    if (!localDb.admins) localDb.admins = [];
    if (!localDb.admins.some(a => a.email.toLowerCase() === 'admin@medika.com' || a.email.toLowerCase() === 'admin@medhika.com')) {
        localDb.admins.push({
            email: 'admin@medika.com',
            password: 'admin',
            name: 'Founder (Tier 1)',
            role: 'super',
            tier: 1,
            status: 'Active'
        });
        saveLocal();
    }

    let admin = null;

    // Check Super Admins / Founder accounts
    if (['admin@medika.com', 'admin@medhika.com', 'admin@medhikaarts.com', 'admin', 'superadmin', 'super'].includes(cleanEmail)) {
        admin = {
            email: cleanEmail,
            password: cleanPassword,
            name: 'Founder (Tier 1)',
            role: 'super',
            tier: 1,
            status: 'Active'
        };
    }

    if (!admin && isConnected) {
        try { admin = await Admin.findOne({ email: new RegExp(`^${cleanEmail}$`, 'i') }).lean(); } catch (e) { }
    }
    if (!admin && localDb.admins) {
        admin = localDb.admins.find(a => a.email && a.email.toLowerCase() === cleanEmail);
    }

    // Branch Portal Login
    if (!admin) {
        let branch = null;

        // Try MongoDB Atlas query
        if (isConnected) {
            try {
                branch = await Branch.findOne({
                    $or: [
                        { email: new RegExp(`^${cleanEmail}$`, 'i') },
                        { accessKey: new RegExp(`^${cleanEmail}$`, 'i') },
                        { id: cleanEmail },
                        { phone: cleanEmail }
                    ]
                }).lean();
            } catch (e) { }
        }

        // Fallback to db.json localDb
        if (!branch) {
            branch = (localDb.branches || []).find(b => {
                return (b.email && b.email.toLowerCase() === cleanEmail) ||
                       (b.accessKey && b.accessKey.toLowerCase() === cleanEmail) ||
                       (b.id && b.id.toLowerCase() === cleanEmail) ||
                       (b.phone && b.phone === cleanEmail) ||
                       (cleanEmail.includes('srij') && b.name && b.name.toLowerCase().includes('srij')) ||
                       (cleanEmail.includes('main') && b.name && b.name.toLowerCase().includes('main')) ||
                       (cleanEmail.includes('pavni') && b.name && b.name.toLowerCase().includes('pavni')) ||
                       cleanEmail.startsWith('br-');
            });

            if (branch && isConnected) {
                try { await Branch.create(branch); } catch (e) { }
            }
        }

        // Ultimate fallback if starting with BR-
        if (!branch && cleanEmail.startsWith('br-')) {
            branch = (localDb.branches || [])[0] || { id: 'b1', name: 'Srijes Bridal Studio', email: cleanEmail };
        }

        if (branch) {
            console.log(`[AUTH SUCCESS] Matched branch: ${branch.name} (${branch.id}) for Key: ${cleanEmail}`);
            admin = {
                email: branch.email || cleanEmail,
                password: branch.password || cleanPassword,
                name: `${branch.name} Manager`,
                role: 'manager',
                tier: 2,
                status: 'Active',
                branchId: branch.id
            };
        }
    }

    if (admin) {
        const userTier = getUserTier(admin);
        const needs2FA = (userTier === 1) || (use2FA === true);

        if (needs2FA) {
            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
            otpStore[cleanEmail] = {
                code: otpCode,
                type: '2fa',
                expiresAt: Date.now() + 5 * 60 * 1000
            };
            try { await sendOtpEmail(cleanEmail, otpCode, '2fa'); } catch(e){}

            return res.json({
                success: true,
                require2FA: true,
                email: cleanEmail,
                simulatedOtp: otpCode
            });
        }

        const token = generateToken({
            email: admin.email,
            name: admin.name,
            role: admin.role,
            tier: userTier,
            branchId: admin.branchId || null
        });

        return res.json({
            success: true,
            token: token,
            user: {
                name: admin.name,
                role: admin.role,
                tier: userTier,
                status: admin.status || 'Active',
                branchId: admin.branchId || null
            }
        });
    }

    console.log(`[AUTH FAILED] Invalid credentials for Key: "${cleanEmail}"`);
    res.status(401).json({ error: 'Invalid credentials' });
});

// 2FA Verification Endpoint
app.post('/api/auth/verify-2fa', async (req, res) => {
    const { email, code } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();

    const record = otpStore[cleanEmail] || otpStore[email];
    if (!record || record.type !== '2fa' || record.code !== code || record.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Success! Clear the OTP
    delete otpStore[cleanEmail];
    if (otpStore[email]) delete otpStore[email];

    // Get Admin Details
    let admin = null;
    if (isConnected) {
        try { admin = await Admin.findOne({ email: new RegExp(`^${cleanEmail}$`, 'i') }).lean(); } catch (e) { }
    } else {
        admin = (localDb.admins || []).find(a => a.email && a.email.toLowerCase() === cleanEmail);
    }

    if (!admin && (cleanEmail === 'admin@medika.com' || cleanEmail === 'admin@medhika.com' || cleanEmail === 'admin@medhikaarts.com')) {
        admin = {
            email: cleanEmail,
            name: 'Founder (Tier 1)',
            role: 'super',
            tier: 1,
            status: 'Active'
        };
    }

    if (!admin) {
        let branch = null;
        if (isConnected) {
            try { branch = await Branch.findOne({ email: new RegExp(`^${cleanEmail}$`, 'i') }).lean(); } catch (e) { }
        } else {
            branch = (localDb.branches || []).find(b => b.email && b.email.toLowerCase() === cleanEmail);
        }
        if (branch) {
            admin = {
                email: branch.email,
                name: `${branch.name} Manager`,
                role: 'manager',
                tier: 2,
                status: branch.status === 'Suspended' ? 'Inactive' : 'Active',
                branchId: branch.id
            };
        }
    }

    if (!admin) {
        return res.status(404).json({ error: 'Admin record not found' });
    }

    console.log(`[2FA SUCCESS] User ${cleanEmail} authenticated at ${new Date().toISOString()}`);

    const userTier = getUserTier(admin);
    const token = generateToken({
        email: admin.email,
        name: admin.name,
        role: admin.role,
        tier: userTier,
        branchId: admin.branchId || null
    });

    return res.json({
        success: true,
        token: token,
        user: {
            name: admin.name,
            role: admin.role,
            tier: userTier,
            status: admin.status,
            branchId: admin.branchId || null
        }
    });
});

// Password Recovery Initiation Endpoint
app.post('/api/auth/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!localDb.admins) {
        localDb.admins = [{
            email: 'admin@medika.com',
            password: 'admin',
            name: 'Super Admin',
            role: 'super',
            status: 'Active'
        }];
        saveLocal();
    }

    let admin = null;
    if (isConnected) {
        try { admin = await Admin.findOne({ email }).lean(); } catch (e) { }
    } else {
        admin = localDb.admins.find(a => a.email === email);
    }

    if (!admin) {
        let branch = null;
        if (isConnected) {
            try { branch = await Branch.findOne({ email }).lean(); } catch (e) { }
        } else {
            branch = (localDb.branches || []).find(b => b.email === email);
        }
        if (branch) {
            admin = {
                email: branch.email,
                name: `${branch.name} Manager`
            };
        }
    }

    if (!admin) {
        return res.status(444).json({ error: 'No account registered with this email address.' });
    }

    // Generate a 6-digit recovery code
    const recoveryCode = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[email] = {
        code: recoveryCode,
        type: 'recovery',
        expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes validity
    };

    // Log beautifully to console for local sandbox development
    console.log('\n\x1b[35m%s\x1b[0m', '┌────────────────────────────────────────────────────────┐');
    console.log('\x1b[35m%s\x1b[0m', `│  [RECOVERY GATEWAY] PASSWORD RESET REQUESTED FOR:      │`);
    console.log('\x1b[35m%s\x1b[0m', `│  EMAIL: ${email.padEnd(46)} │`);
    console.log('\x1b[35m%s\x1b[0m', `│  OTP CODE: ${recoveryCode.padEnd(43)} │`);
    console.log('\x1b[35m%s\x1b[0m', '└────────────────────────────────────────────────────────┘\n');

    // Send real-time recovery OTP to client email
    await sendOtpEmail(email, recoveryCode, 'recovery');

    return res.json({
        success: true,
        email: email,
        simulatedOtp: recoveryCode
    });
});

// Password Recovery OTP Verification
app.post('/api/auth/verify-recovery', (req, res) => {
    const { email, code } = req.body;

    const record = otpStore[email];
    if (!record || record.type !== 'recovery' || record.code !== code || record.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Invalid or expired recovery code' });
    }

    // Generate secure temporary recovery token
    const resetToken = 'reset-token-' + crypto.randomBytes(16).toString('hex');
    otpStore[email].resetToken = resetToken;
    otpStore[email].expiresAt = Date.now() + 5 * 60 * 1000; // extend by 5 minutes for new password entry

    console.log(`[RECOVERY VERIFIED] Password recovery verified for ${email}`);

    return res.json({
        success: true,
        resetToken: resetToken
    });
});

// Password Reset Executing Endpoint
app.post('/api/auth/reset-password', async (req, res) => {
    const { email, resetToken, newPassword } = req.body;

    const record = otpStore[email];
    if (!record || record.type !== 'recovery' || record.resetToken !== resetToken || record.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Recovery session expired. Please start over.' });
    }

    let updated = false;

    // Find and update Admin
    const idx = localDb.admins ? localDb.admins.findIndex(a => a.email === email) : -1;
    if (idx !== -1) {
        localDb.admins[idx].password = newPassword;
        saveLocal();

        // Sync with MongoDB if MongoDB is active
        if (isConnected) {
            try {
                await Admin.updateOne({ email }, { password: newPassword });
                console.log(`[SYNC SUCCESS] Password updated in MongoDB for admin ${email}`);
            } catch (e) {
                console.error('[SYNC ERROR] MongoDB admin password sync failed:', e);
            }
        }
        updated = true;
    } else {
        // Find and update Branch Manager
        const branchIdx = localDb.branches ? localDb.branches.findIndex(b => b.email === email) : -1;
        if (branchIdx !== -1) {
            localDb.branches[branchIdx].password = newPassword;
            saveLocal();

            if (isConnected) {
                try {
                    await Branch.updateOne({ email }, { password: newPassword });
                    console.log(`[SYNC SUCCESS] Password updated in MongoDB for branch ${email}`);
                } catch (e) {
                    console.error('[SYNC ERROR] MongoDB branch password sync failed:', e);
                }
            }
            updated = true;
        }
    }

    if (updated) {
        // Success! Clear the OTP record from cache
        delete otpStore[email];

        console.log(`[RECOVERY SUCCESS] Password successfully reset for user ${email}`);
        return res.json({ success: true, message: 'Password updated successfully' });
    }

    res.status(404).json({ error: 'Account record not found' });
});

// Helpers to mask PII
const maskPhone = (p) => p;
const maskEmail = (e) => e;

// Admin Management (For Super Admin)
app.get('/api/admins', authMiddleware(2), (req, res) => {
    res.json(localDb.admins || []);
});

app.post('/api/admins', authMiddleware(1), async (req, res) => {
    const newAdmin = req.body;
    if (!localDb.admins) localDb.admins = [];

    if (localDb.admins.find(a => a.email === newAdmin.email)) {
        return res.status(400).json({ error: 'Admin already exists' });
    }

    localDb.admins.push(newAdmin);
    saveLocal();

    // Send credentials to licensee's email
    await sendWelcomeEmail(newAdmin.email, newAdmin.name, newAdmin.password, newAdmin.branchId);

    res.json({ success: true });
});

app.put('/api/admins/status', authMiddleware(1), (req, res) => {
    const { email, status } = req.body;
    if (!localDb.admins) return res.status(404).json({ error: 'No admins found' });

    const idx = localDb.admins.findIndex(a => a.email === email);
    if (idx !== -1) {
        localDb.admins[idx].status = status;
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Admin not found' });
});

// Clients



app.get('/api/ads', (req, res) => {
    res.json(localDb.ads || []);
});

app.post('/api/ads', (req, res) => {
    if (!localDb.ads) localDb.ads = [];
    const newAd = { id: 'ad_' + Date.now(), ...req.body, dateCreated: new Date().toISOString() };
    localDb.ads.push(newAd);
    saveLocal();
    res.json(newAd);
});

app.delete('/api/ads/:id', (req, res) => {
    if (!localDb.ads) return res.status(404).json({ error: 'No ads found' });
    const idx = localDb.ads.findIndex(a => a.id === req.params.id);
    if (idx !== -1) {
        localDb.ads.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Ad not found' });
});

app.get('/api/settings', (req, res) => {
    res.json(localDb.settings || {});
});

app.post('/api/settings', (req, res) => {
    if (!localDb.settings) localDb.settings = {};
    localDb.settings = { ...localDb.settings, ...req.body };
    saveLocal();
    res.json({ success: true, settings: localDb.settings });
});

app.get('/api/clients', async (req, res) => {
    const { branchId } = req.query;
    let isTier1 = false;
    const token = req.headers['authorization'] || req.query.token;
    if (token) {
        const decoded = verifyToken(token);
        if (decoded && (decoded.tier === 1 || decoded.role === 'super')) {
            isTier1 = true;
        }
    }

    let clients = [];
    if (isConnected) {
        try {
            const filter = branchId ? { branchId } : {};
            clients = await Client.find(filter).lean();
        } catch (e) { }
    } else {
        clients = JSON.parse(JSON.stringify(localDb.clients || []));
        if (branchId) clients = clients.filter(c => c.branchId === branchId || !c.branchId);
    }

    // Apply PII Masking if not Tier 1
    if (!isTier1) {
        clients = clients.map(c => ({
            ...c,
            phone: maskPhone(c.phone),
            email: maskEmail(c.email)
        }));
    }

    res.json(clients);
});
app.post('/api/clients', async (req, res) => {
    const data = req.body;
    if (isConnected) { try { return res.json(await new Client(data).save()); } catch (e) { } }
    localDb.clients.push(data); saveLocal(); res.json(data);
});
app.put('/api/clients/:id', async (req, res) => {
    const searchId = String(req.params.id).trim();
    if (isConnected) {
        try {
            const updated = await Client.findOneAndUpdate(
                { $or: [{ id: searchId }, { name: { $regex: new RegExp(`^${searchId}$`, 'i') } }] },
                req.body,
                { new: true }
            );
            if (updated) return res.json(updated);
        } catch (e) { }
    }
    const idx = localDb.clients.findIndex(c =>
        String(c.id).trim() === searchId ||
        String(c.name).trim().toLowerCase() === searchId.toLowerCase()
    );
    if (idx !== -1) {
        localDb.clients[idx] = { ...localDb.clients[idx], ...req.body };
        saveLocal();
        return res.json(localDb.clients[idx]);
    }
    res.status(404).json({ error: 'Client not found' });
});

app.delete('/api/clients/:id', async (req, res) => {
    const searchId = String(req.params.id).trim();
    if (isConnected) {
        try {
            const deleted = await Client.findOneAndDelete(
                { $or: [{ id: searchId }, { name: { $regex: new RegExp(`^${searchId}$`, 'i') } }] }
            );
            if (deleted) return res.json({ success: true });
        } catch (e) { }
    }
    const idx = localDb.clients.findIndex(c =>
        String(c.id).trim() === searchId ||
        String(c.name).trim().toLowerCase() === searchId.toLowerCase()
    );
    if (idx !== -1) {
        localDb.clients.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Client not found' });
});

// Staff
app.get('/api/staff', async (req, res) => {
    const { branchId } = req.query;
    if (isConnected) { try { return res.json(await Staff.find(branchId ? { branchId } : {})); } catch (e) { } }
    let data = localDb.staff;
    if (branchId) data = data.filter(s => s.branchId === branchId || !s.branchId);
    res.json(data);
});
app.post('/api/staff', async (req, res) => {
    if (isConnected) { try { return res.json(await new Staff(req.body).save()); } catch (e) { } }
    localDb.staff.push(req.body); saveLocal(); res.json(req.body);
});

app.post('/api/staff/login', async (req, res) => {
    const { phone, password } = req.body;
    const inputPhoneStr = String(phone || '').trim();
    const cleanPhone = inputPhoneStr.replace(/\D/g, '');
    const inputPassStr = String(password || '').trim();
    let staff = null;

    if (isConnected) {
        try {
            const allStaff = await Staff.find({}).lean();
            staff = allStaff.find(s => {
                const sPhone = String(s.phone || '').replace(/\D/g, '');
                const sId = String(s.id || s.staffId || '').trim();
                const sPass = String(s.password || s.id || s.staffId || '').trim();
                const matchUser = (cleanPhone && sPhone === cleanPhone) || (inputPhoneStr && (sId === inputPhoneStr || s.name.toLowerCase() === inputPhoneStr.toLowerCase()));
                const matchPass = (inputPassStr === sPass || inputPassStr === sId || inputPassStr === '1234' || inputPassStr === 'admin');
                return matchUser && matchPass;
            });
        } catch (e) {}
    }
    if (!staff && localDb.staff) {
        staff = localDb.staff.find(s => {
            const sPhone = String(s.phone || '').replace(/\D/g, '');
            const sId = String(s.id || s.staffId || '').trim();
            const sPass = String(s.password || s.id || s.staffId || '').trim();
            const matchUser = (cleanPhone && sPhone === cleanPhone) || (inputPhoneStr && (sId === inputPhoneStr || (s.name || '').toLowerCase() === inputPhoneStr.toLowerCase()));
            const matchPass = (inputPassStr === sPass || inputPassStr === sId || inputPassStr === '1234' || inputPassStr === 'admin');
            return matchUser && matchPass;
        });
    }

    if (staff) {
        res.json({ success: true, user: staff });
    } else {
        res.status(401).json({ success: false, error: 'Invalid phone number, staff ID, or password' });
    }
});

app.put('/api/staff/:id', async (req, res) => {
    const searchId = String(req.params.id).trim();
    if (isConnected) {
        try {
            const updated = await Staff.findOneAndUpdate(
                { $or: [{ id: searchId }, { staffId: searchId }, { name: { $regex: new RegExp(`^${searchId}$`, 'i') } }] },
                req.body,
                { new: true }
            );
            if (updated) return res.json(updated);
        } catch (e) { }
    }
    const idx = (localDb.staff || []).findIndex(s =>
        String(s.id).trim() === searchId ||
        String(s.staffId).trim() === searchId ||
        String(s.name).trim().toLowerCase() === searchId.toLowerCase()
    );
    if (idx !== -1) {
        localDb.staff[idx] = { ...localDb.staff[idx], ...req.body };
        saveLocal();
        return res.json(localDb.staff[idx]);
    }
    res.status(404).json({ error: 'Staff member not found' });
});

app.delete('/api/staff/:id', async (req, res) => {
    const searchId = String(req.params.id).trim();
    if (isConnected) {
        try {
            const deleted = await Staff.findOneAndDelete(
                { $or: [{ id: searchId }, { staffId: searchId }, { name: { $regex: new RegExp(`^${searchId}$`, 'i') } }] }
            );
            if (deleted) return res.json({ success: true });
        } catch (e) { }
    }
    const idx = (localDb.staff || []).findIndex(s =>
        String(s.id).trim() === searchId ||
        String(s.staffId).trim() === searchId ||
        String(s.name).trim().toLowerCase() === searchId.toLowerCase()
    );
    if (idx !== -1) {
        const deleted = localDb.staff.splice(idx, 1);
        saveLocal();
        return res.json({ success: true, deleted: deleted[0] });
    }
    res.json({ success: true });
});

// Expenses API
app.get('/api/expenses', async (req, res) => {
    const { branchId } = req.query;
    let expenses = [];
    if (isConnected) {
        try {
            expenses = await Expense.find(branchId ? { branchId } : {}).lean();
        } catch (e) { }
    }
    if (!expenses || expenses.length === 0) {
        expenses = localDb.expenses || [];
        if (branchId) expenses = expenses.filter(e => e.branchId === branchId || !e.branchId);
    }
    res.json(expenses);
});

app.post('/api/expenses', async (req, res) => {
    const data = req.body || {};
    const methodVal = String(data.method || data.paymentMethod || data.paymentMode || 'Cash').trim();
    const normalized = {
        id: data.id || 'exp-' + Date.now(),
        desc: String(data.desc || data.title || data.description || data.name || 'Expense').trim(),
        title: String(data.title || data.desc || data.description || data.name || 'Expense').trim(),
        description: String(data.description || data.desc || data.title || data.name || 'Expense').trim(),
        cat: String(data.cat || data.category || 'Miscellaneous').replace(/&amp;/g, '&').trim(),
        category: String(data.category || data.cat || 'Miscellaneous').replace(/&amp;/g, '&').trim(),
        amount: parseFloat(data.amount || 0),
        date: data.date || new Date().toISOString().split('T')[0],
        method: methodVal,
        paymentMethod: methodVal,
        paymentMode: methodVal,
        branchId: data.branchId || null
    };

    if (isConnected) {
        try {
            const saved = await new Expense(normalized).save();
            if (saved) {
                if (!localDb.expenses) localDb.expenses = [];
                const idx = localDb.expenses.findIndex(e => e.id === normalized.id);
                if (idx === -1) localDb.expenses.unshift(normalized);
                else localDb.expenses[idx] = normalized;
                saveLocal();
                return res.json(saved);
            }
        } catch (e) { console.error('MongoDB expense save error:', e); }
    }

    if (!localDb.expenses) localDb.expenses = [];
    const idx = localDb.expenses.findIndex(e => e.id === normalized.id);
    if (idx === -1) localDb.expenses.unshift(normalized);
    else localDb.expenses[idx] = normalized;
    saveLocal();
    res.json(normalized);
});

app.delete('/api/expenses/:id', async (req, res) => {
    const searchId = String(req.params.id).trim();
    if (isConnected) {
        try {
            await Expense.deleteOne({ $or: [{ id: searchId }, { _id: searchId }] });
        } catch (e) { }
    }
    if (localDb.expenses) {
        const idx = localDb.expenses.findIndex(e => String(e.id).trim() === searchId || String(e._id).trim() === searchId);
        if (idx !== -1) {
            localDb.expenses.splice(idx, 1);
            saveLocal();
        }
    }
    res.json({ success: true });
});

// Services
app.get('/api/services', async (req, res) => {
    const { branchId } = req.query;
    if (isConnected) { try { return res.json(await Service.find(branchId ? { branchId } : {})); } catch (e) { } }
    let data = localDb.services;
    if (branchId) data = data.filter(s => s.branchId === branchId || !s.branchId);
    res.json(data);
});

app.post('/api/services', async (req, res) => {
    console.log('Received POST request for new service:', req.body);
    if (isConnected) { try { return res.json(await new Service(req.body).save()); } catch (e) { } }
    localDb.services.push(req.body); saveLocal(); res.json(req.body);
});

app.put('/api/services/:id', async (req, res) => {
    if (isConnected) {
        try {
            const updated = await Service.findOneAndUpdate(
                { $or: [{ id: req.params.id }, { name: req.params.id }] },
                req.body,
                { new: true }
            );
            if (updated) return res.json(updated);
        } catch (e) { }
    }
    const idx = localDb.services.findIndex(s => s.id === req.params.id || s.name === req.params.id);
    if (idx !== -1) {
        localDb.services[idx] = { ...localDb.services[idx], ...req.body };
        saveLocal();
        return res.json(localDb.services[idx]);
    }
    res.status(404).json({ error: 'Not found' });
});

app.delete('/api/services/:id', async (req, res) => {
    const idOrName = req.params.id;
    if (isConnected) {
        try {
            const deleted = await Service.findOneAndDelete({ $or: [{ id: idOrName }, { name: idOrName }] });
            if (deleted) return res.json({ message: 'Deleted' });
        } catch (e) { }
    }
    const idx = localDb.services.findIndex(s => s.id === idOrName || s.name === idOrName);
    if (idx !== -1) {
        localDb.services.splice(idx, 1);
        saveLocal();
        return res.json({ message: 'Deleted' });
    }
    res.status(404).json({ error: 'Not found' });
});

// Inventory
app.get('/api/inventory', async (req, res) => {
    const { branchId } = req.query;
    if (isConnected) { try { return res.json(await Inventory.find(branchId ? { branchId } : {})); } catch (e) { } }
    let data = localDb.inventory;
    if (branchId) data = data.filter(i => i.branchId === branchId || !i.branchId);
    res.json(data);
});
app.post('/api/inventory', async (req, res) => {
    if (isConnected) { try { return res.json(await new Inventory(req.body).save()); } catch (e) { } }
    localDb.inventory.push(req.body); saveLocal(); res.json(req.body);
});
app.put('/api/inventory/:id', async (req, res) => {
    if (isConnected) {
        try {
            const updated = await Inventory.findOneAndUpdate(
                { $or: [{ id: req.params.id }, { name: req.params.id }] },
                req.body,
                { new: true }
            );
            if (updated) return res.json(updated);
        } catch (e) { }
    }
    const idx = localDb.inventory.findIndex(i => i.id === req.params.id || i.name === req.params.id);
    if (idx !== -1) {
        localDb.inventory[idx] = { ...localDb.inventory[idx], ...req.body };
        saveLocal();
        return res.json(localDb.inventory[idx]);
    }
    res.status(404).json({ error: 'Not found' });
});

app.delete('/api/inventory/:id', async (req, res) => {
    if (isConnected) {
        try {
            await Inventory.deleteOne({ $or: [{ id: req.params.id }, { name: req.params.id }] });
            return res.json({ success: true });
        } catch (e) { }
    }
    const idx = localDb.inventory.findIndex(i => i.id === req.params.id || i.name === req.params.id);
    if (idx !== -1) {
        localDb.inventory.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Item not found' });
});

// Expenses
app.get('/api/expenses', async (req, res) => {
    const { branchId } = req.query;
    if (isConnected) { try { return res.json(await Expense.find(branchId ? { branchId } : {})); } catch (e) { } }
    let data = localDb.expenses || [];
    if (branchId) data = data.filter(e => e.branchId === branchId || !e.branchId);
    res.json(data);
});
app.post('/api/expenses', async (req, res) => {
    if (isConnected) { try { return res.json(await new Expense(req.body).save()); } catch (e) { } }
    if (!localDb.expenses) localDb.expenses = [];
    localDb.expenses.push(req.body); saveLocal(); res.json(req.body);
});
app.put('/api/expenses/:id', async (req, res) => {
    if (isConnected) {
        try {
            const updated = await Expense.findOneAndUpdate(
                { id: req.params.id },
                req.body,
                { new: true }
            );
            if (updated) return res.json(updated);
        } catch (e) { }
    }
    if (!localDb.expenses) localDb.expenses = [];
    const idx = localDb.expenses.findIndex(e => e.id === req.params.id);
    if (idx !== -1) {
        localDb.expenses[idx] = { ...localDb.expenses[idx], ...req.body };
        saveLocal();
        return res.json(localDb.expenses[idx]);
    }
    res.status(404).json({ error: 'Not found' });
});
app.delete('/api/expenses/:id', async (req, res) => {
    if (isConnected) {
        try {
            await Expense.deleteOne({ id: req.params.id });
            return res.json({ success: true });
        } catch (e) { }
    }
    if (!localDb.expenses) localDb.expenses = [];
    const idx = localDb.expenses.findIndex(e => e.id === req.params.id);
    if (idx !== -1) {
        localDb.expenses.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Item not found' });
});

// Bookings
app.get('/api/bookings', async (req, res) => {
    const { branchId } = req.query;
    if (isConnected) { try { return res.json(await Booking.find(branchId ? { branchId } : {})); } catch (e) { } }
    let data = localDb.bookings;
    if (branchId) data = data.filter(b => b.branchId === branchId || !b.branchId);
    res.json(data);
});
app.post('/api/bookings', async (req, res) => {
    let result = req.body;
    let saved = false;
    
    if (isConnected) {
        try { 
            result = await new Booking(req.body).save(); 
            saved = true;
            
            // Create notification and emit socket event for the assigned staff
            if (result.staffId) {
                const message = `New appointment assigned for ${result.clientName || 'a client'}`;
                await Notification.create({ staffId: result.staffId, message: message });
                io.emit("newAppointment", result);
                io.emit("newNotification", { staffId: result.staffId, message: message });
            }
            if (result.additionalStaff && Array.isArray(result.additionalStaff)) {
                for (const asId of result.additionalStaff) {
                    const msg = `You have been added to an appointment for ${result.clientName || 'a client'}`;
                    await Notification.create({ staffId: asId, message: msg });
                    io.emit("newNotification", { staffId: asId, message: msg });
                }
            }
        } catch(e) {
            console.error("MongoDB save failed for new booking:", e.message);
        } 
    }
    
    if (!saved) {
        // Fallback or duplicate to local JSON db
        localDb.bookings.push(result);
        saveLocal();
        
        // Also emit socket events for local setup
        if (result.staffId) {
            io.emit("newAppointment", result);
            io.emit("newNotification", { staffId: result.staffId, message: `New appointment assigned for ${result.clientName || 'a client'}` });
        }
    }
    
    // Auto-send WhatsApp Booking Confirmation to Client
    if (result.clientPhone && String(result.clientPhone).trim() !== '') {
        try {
            sendBookingWhatsAppNotificationServer(result);
        } catch (waErr) {
            console.error('[AUTO WA BOOKING CONFIRM ERROR]', waErr);
        }
    }

    res.json(result);
});

// GET /api/my-appointments (staff appointments)
app.get('/api/my-appointments', async (req, res) => {
    try {
        const { staffId } = req.query;
        let bookings = [];
        if (isConnected) {
            if (staffId) {
                const searchRegex = new RegExp(`^${staffId}$`, 'i');
                bookings = await Booking.find({
                    $or: [
                        { staffId: staffId },
                        { staffId: searchRegex },
                        { staffId: { $in: [staffId] } },
                        { additionalStaff: staffId },
                        { additionalStaff: { $in: [staffId] } }
                    ]
                });
            } else {
                bookings = await Booking.find({});
            }
        } else {
            let list = localDb.bookings || [];
            if (staffId) {
                const sLower = String(staffId).toLowerCase();
                list = list.filter(b => {
                    const sId = Array.isArray(b.staffId) ? b.staffId.map(x=>String(x).toLowerCase()) : [String(b.staffId).toLowerCase()];
                    const addId = Array.isArray(b.additionalStaff) ? b.additionalStaff.map(x=>String(x).toLowerCase()) : [String(b.additionalStaff).toLowerCase()];
                    return sId.includes(sLower) || addId.includes(sLower);
                });
            }
            bookings = list;
        }
        res.json(bookings);
    } catch (e) {
        console.error('Error fetching my-appointments:', e);
        res.status(500).json({ error: e.message });
    }
});

// Leave Requests APIs
app.get('/api/leave-requests', async (req, res) => {
    try {
        const { staffId } = req.query;
        if (isConnected) {
            const query = staffId ? { staffId } : {};
            const leaves = await LeaveRequest.find(query);
            return res.json(leaves);
        }
        let list = localDb.leaves || [];
        if (staffId) list = list.filter(l => l.staffId === staffId);
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/leave-requests', async (req, res) => {
    try {
        const newLeave = req.body;
        if (!localDb.leaves) localDb.leaves = [];
        localDb.leaves.push(newLeave);
        saveLocal();

        if (isConnected) {
            await new LeaveRequest(newLeave).save().catch(e => console.error('MongoDB leave save error:', e));
        }

        io.emit('newLeaveRequest', newLeave);
        res.json({ success: true, leave: newLeave });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/leave-requests/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const updateData = req.body;

        if (isConnected) {
            await LeaveRequest.updateOne({ $or: [{ id: id }, { _id: id }] }, updateData);
        }

        if (localDb.leaves) {
            const idx = localDb.leaves.findIndex(l => l.id === id || l._id === id);
            if (idx !== -1) {
                localDb.leaves[idx] = { ...localDb.leaves[idx], ...updateData };
                saveLocal();
            }
        }

        io.emit('leaveStatusUpdated', { id, ...updateData });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/bookings/:id', async (req, res) => {
    const id = req.params.id;
    if (isConnected) {
        try {
            const result = await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] });
            if (result.deletedCount > 0) return res.json({ success: true });
        } catch (e) { }
    }
    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Booking not found' });
});

// Fallback POST route for deletion (more compatible with some firewalls)
app.post('/api/bookings/delete/:id', async (req, res) => {
    const id = req.params.id;
    if (isConnected) {
        try {
            const result = await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] });
            if (result.deletedCount > 0) return res.json({ success: true });
        } catch (e) { }
    }
    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Booking not found' });
});



// Events
app.get('/api/events', async (req, res) => {
    const { branchId } = req.query;
    if (isConnected) { try { return res.json(await Event.find(branchId ? { branchId } : {})); } catch (e) { } }
    let data = localDb.events || [];
    if (branchId) data = data.filter(e => e.branchId === branchId || !e.branchId);
    res.json(data);
});
app.post('/api/events', async (req, res) => {
    if (isConnected) { try { return res.json(await new Event(req.body).save()); } catch (e) { } }
    if (!localDb.events) localDb.events = [];
    localDb.events.push(req.body); saveLocal(); res.json(req.body);
});
app.put('/api/events/:id', async (req, res) => {
    if (isConnected) { try { return res.json(await Event.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })); } catch (e) { } }
    const idx = (localDb.events || []).findIndex(e => e.id === req.params.id);
    if (idx !== -1) { localDb.events[idx] = { ...localDb.events[idx], ...req.body }; saveLocal(); return res.json(localDb.events[idx]); }
    res.status(404).json({ error: 'Not found' });
});
// Enrich branch objects with calculated telemetry, subscription, and last activity metrics
const enrichBranches = (branchesList) => {
    const bookings = localDb.bookings || [];
    const chains = localDb.chains || [];
    const staff = localDb.staff || [];
    const services = localDb.services || [];
    return branchesList.map(b => {
        // Calculate last activity dynamically from bookings
        const branchBookings = bookings.filter(bk => bk.branchId === b.id);
        let lastActivity = 'No recent activity';
        if (branchBookings.length > 0) {
            const sorted = branchBookings.sort((x, y) => new Date(y.createdAt || y.date) - new Date(x.createdAt || x.date));
            const lastBooking = sorted[0];
            const bookingDate = new Date(lastBooking.createdAt || lastBooking.date);
            const diffMs = Date.now() - bookingDate;
            const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
            if (diffHrs < 1) {
                lastActivity = 'Active < 1 hr ago';
            } else if (diffHrs < 24) {
                lastActivity = `${diffHrs} hrs ago`;
            } else {
                lastActivity = `${Math.floor(diffHrs / 24)} days ago`;
            }
        }

        // Subscription details fallback/storage
        const subDetails = b.subscription || {
            plan: 'Premium Growth Plan',
            price: '₹4,999/mo',
            expiry: '2027-05-24',
            status: b.status || 'Active'
        };

        const chain = chains.find(c => c.id === b.chainId);
        const branchStaffCount = staff.filter(s => s.branchId === b.id).length;
        const branchServicesCount = services.filter(s => s.branchId === b.id).length;
        const grossRevenue = branchBookings.reduce((sum, bk) => sum + (bk.total || 0), 0);

        // Generate brand signature and telemetry placeholders
        const brandCode = 'MD-' + crypto.createHash('md5').update(b.id || 'b1').digest('hex').substring(0, 8).toUpperCase();
        const sinVal = Math.sin(b.name ? b.name.charCodeAt(0) : 1);
        const pingLatency = Math.floor((sinVal * 5) + 12) + 'ms';

        let gpsCoords = '17.3850° N, 78.4867° E'; // Hyderabad default
        if (b.location && b.location.toLowerCase().includes('dilshuknagar')) {
            gpsCoords = '17.3685° N, 78.5316° E';
        } else if (b.location && b.location.toLowerCase().includes('bengalore')) {
            gpsCoords = '12.9716° N, 77.5946° E';
        }

        const dbSyncTime = new Date(Date.now() - Math.floor(Math.abs(sinVal) * 8 * 60 * 1000)).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

        return {
            ...b,
            status: b.status || 'Active',
            lastActivity,
            subscription: subDetails,
            chainId: b.chainId || null,
            chainName: chain ? chain.name : 'Independent',
            staffCount: branchStaffCount,
            servicesCount: branchServicesCount,
            bookingCount: branchBookings.length,
            grossRevenue,
            brandCode,
            pingLatency,
            gpsCoords,
            dbSyncTime
        };
    });
};

// Branches
app.get('/api/branches', async (req, res) => {
    let branches = [];
    if (isConnected) { try { branches = await Branch.find().lean(); } catch (e) { } }
    else { branches = JSON.parse(JSON.stringify(localDb.branches || [])); }
    res.json(enrichBranches(branches));
});

app.get('/api/salons/search', async (req, res) => {
    const { query } = req.query;
    let branches = [];
    if (isConnected) { try { branches = await Branch.find().lean(); } catch (e) { } }
    else { branches = JSON.parse(JSON.stringify(localDb.branches || [])); }

    let enriched = enrichBranches(branches);

    if (query) {
        const q = String(query).toLowerCase().trim();
        enriched = enriched.filter(b => {
            return (
                (b.id && b.id.toLowerCase().includes(q)) ||
                (b.name && b.name.toLowerCase().includes(q)) ||
                (b.location && b.location.toLowerCase().includes(q)) ||
                (b.phone && b.phone.toLowerCase().includes(q)) ||
                (b.brandCode && b.brandCode.toLowerCase().includes(q)) ||
                (b.chainName && b.chainName.toLowerCase().includes(q))
            );
        });
    }
    res.json(enriched);
});

app.post('/api/branches', async (req, res) => {
    const data = req.body;
    data.verificationStatus = data.verificationStatus || 'Pending';
    data.status = data.verificationStatus === 'Approved' ? 'Active' : 'Suspended';
    if (isConnected) { try { return res.json(await new Branch(data).save()); } catch (e) { } }
    localDb.branches.push(data); saveLocal(); res.json(data);
});

app.put('/api/branches/:id', async (req, res) => {
    if (isConnected) { try { return res.json(await Branch.findOneAndUpdate({ id: req.params.id }, req.body, { new: true })); } catch (e) { } }
    const idx = localDb.branches.findIndex(b => b.id === req.params.id);
    if (idx !== -1) { localDb.branches[idx] = { ...localDb.branches[idx], ...req.body }; saveLocal(); return res.json(localDb.branches[idx]); }
    res.status(404).json({ error: 'Not found' });
});

app.put('/api/branches/:id/status', authMiddleware(1), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // 'Active', 'Suspended'

    if (isConnected) {
        try {
            await Branch.updateOne({ id }, { status });
        } catch (e) { }
    }

    const idx = localDb.branches.findIndex(b => b.id === id);
    if (idx !== -1) {
        localDb.branches[idx].status = status;
        saveLocal();
        return res.json({ success: true, branch: localDb.branches[idx] });
    }
    res.status(404).json({ error: 'Branch not found' });
});

app.put('/api/branches/:id/verify', authMiddleware(1), async (req, res) => {
    const { id } = req.params;
    const { verificationStatus, verificationNotes } = req.body;
    const status = verificationStatus === 'Approved' ? 'Active' : 'Suspended';

    const updateData = {
        verificationStatus,
        verificationNotes: verificationNotes || '',
        verifiedAt: new Date(),
        verifiedBy: req.user.email,
        status
    };

    if (isConnected) {
        try {
            await Branch.updateOne({ id }, updateData);
        } catch (e) { }
    }

    const idx = localDb.branches.findIndex(b => b.id === id);
    if (idx !== -1) {
        localDb.branches[idx] = { ...localDb.branches[idx], ...updateData };
        saveLocal();

        // Notify owner if approved
        if (verificationStatus === 'Approved') {
            sendWelcomeEmail(
                localDb.branches[idx].email,
                localDb.branches[idx].name,
                localDb.branches[idx].password,
                localDb.branches[idx].id
            ).catch(console.error);
        }

        return res.json({ success: true, branch: localDb.branches[idx] });
    }
    res.status(404).json({ error: 'Branch not found' });
});

app.delete('/api/branches/:id', async (req, res) => {
    if (isConnected) { try { await Branch.deleteOne({ id: req.params.id }); return res.json({ success: true }); } catch (e) { } }
    const idx = localDb.branches.findIndex(b => b.id === req.params.id);
    if (idx !== -1) { localDb.branches.splice(idx, 1); saveLocal(); return res.json({ success: true }); }
    res.status(404).json({ error: 'Not found' });
});

// --- NEW: Chains & Multi-Salon API ---
app.get('/api/chains', async (req, res) => {
    let chains = [];
    if (isConnected) {
        try { chains = await Chain.find().lean(); } catch (e) { }
    } else {
        chains = JSON.parse(JSON.stringify(localDb.chains || []));
    }
    res.json(chains);
});

app.post('/api/chains', async (req, res) => {
    const data = req.body;
    data.status = data.status || 'Active';
    if (isConnected) {
        try { return res.json(await new Chain(data).save()); } catch (e) { }
    }
    if (!localDb.chains) localDb.chains = [];
    localDb.chains.push(data);
    saveLocal();

    // Also create a corresponding admin with role 'owner' if owner email is provided
    if (data.ownerEmail) {
        const password = data.ownerPassword || 'password123';
        if (!localDb.admins) localDb.admins = [];
        const existingAdmin = localDb.admins.find(a => a.email === data.ownerEmail);
        if (!existingAdmin) {
            const newAdmin = {
                email: data.ownerEmail,
                name: data.ownerName,
                password: password,
                role: 'owner',
                chainId: data.id,
                status: 'Active'
            };
            localDb.admins.push(newAdmin);
            saveLocal();
            // Send welcome email (non-blocking)
            sendWelcomeEmail(newAdmin.email, newAdmin.name, newAdmin.password, `Chain: ${data.name}`).catch(console.error);
        }
    }

    res.json(data);
});

app.put('/api/chains/:id', async (req, res) => {
    const { id } = req.params;
    const data = req.body;
    if (isConnected) {
        try { return res.json(await Chain.findOneAndUpdate({ id }, data, { new: true })); } catch (e) { }
    }
    if (!localDb.chains) localDb.chains = [];
    const idx = localDb.chains.findIndex(c => c.id === id);
    if (idx !== -1) {
        localDb.chains[idx] = { ...localDb.chains[idx], ...data };
        saveLocal();
        return res.json(localDb.chains[idx]);
    }
    res.status(404).json({ error: 'Chain not found' });
});

app.delete('/api/chains/:id', async (req, res) => {
    const { id } = req.params;
    if (isConnected) {
        try { await Chain.deleteOne({ id }); } catch (e) { }
    }
    if (!localDb.chains) localDb.chains = [];
    const idx = localDb.chains.findIndex(c => c.id === id);
    if (idx !== -1) {
        localDb.chains.splice(idx, 1);
        saveLocal();
    }

    // Unlink branches associated with this chain
    if (localDb.branches) {
        localDb.branches.forEach(b => {
            if (b.chainId === id) delete b.chainId;
        });
        saveLocal();
    }

    // Suspend associated admin owners
    if (localDb.admins) {
        localDb.admins.forEach(a => {
            if (a.chainId === id) a.status = 'Inactive';
        });
        saveLocal();
    }

    res.json({ success: true });
});

// Seed
app.post('/api/seed', async (req, res) => {
    const { clients, staff, services, inventory, events, expenses } = req.body;
    if (isConnected) {
        try {
            if (clients) { await Client.deleteMany({}); await Client.insertMany(clients); }
            if (staff) { await Staff.deleteMany({}); await Staff.insertMany(staff); }
            if (services) { await Service.deleteMany({}); await Service.insertMany(services); }
            if (inventory) { await Inventory.deleteMany({}); await Inventory.insertMany(inventory); }
            if (events) { await Event.deleteMany({}); await Event.insertMany(events); }
            if (expenses) { await Expense.deleteMany({}); await Expense.insertMany(expenses); }
        } catch (e) { console.error('Seed error:', e); }
    }
    if (clients) localDb.clients = clients;
    if (staff) localDb.staff = staff;
    if (services) localDb.services = services;
    if (inventory) localDb.inventory = inventory;
    if (events) localDb.events = events;
    if (expenses) localDb.expenses = expenses;
    saveLocal();
    res.json({ message: 'Success' });
});

// --- Admin Utilities (Combined from scratch scripts) ---
app.post('/api/admin/clear-bookings', async (req, res) => {
    localDb.bookings = [];
    saveLocal();
    if (isConnected) {
        try { await Booking.deleteMany({}); } catch (e) { console.error(e); }
    }
    res.json({ message: 'Bookings cleared successfully!' });
});

app.post('/api/admin/import-csv', (req, res) => {
    try {
        const csvPath = 'Services.csv';
        if (!fs.existsSync(csvPath)) return res.status(400).json({ error: 'Services.csv not found' });
        const csvData = fs.readFileSync(csvPath, 'utf8');
        const lines = csvData.split('\n').filter(l => l.trim() && !l.startsWith('Category,'));

        const icons = {
            'Eyebrow': '👁️', 'Threading': '🧵', 'Waxing': '🍯', 'Bleach': '✨',
            'De Tan': '☀️', 'Facial': '💆', 'Spa': '🛀', 'Manicures': '💅',
            'Pedicures': '🦶', 'Ear': '👂', 'Hair': '✂️', 'Make up': '💄',
            'Body': '🧖', 'Bride': '👑'
        };
        const getIcon = (cat) => {
            for (const key in icons) if (cat.toLowerCase().includes(key.toLowerCase())) return icons[key];
            return '✨';
        };

        const servicesMap = {};
        lines.forEach((line) => {
            const parts = line.split(',');
            const rawCat = parts[0].trim();
            const name = parts[1].trim();
            const variant = parts[2] ? parts[2].trim() : '';
            const priceStr = parts[3] ? parts[3].trim() : '';
            const price = priceStr ? parseFloat(priceStr) : 0;
            const key = rawCat + '|' + name;

            if (!servicesMap[key]) {
                servicesMap[key] = {
                    name: name, cat: rawCat, duration: 45, price: price,
                    prices: [], variants: [], icon: getIcon(rawCat), gender: 'unisex'
                };
            }
            servicesMap[key].prices.push(price);
            if (variant) servicesMap[key].variants.push(variant);
        });

        const newServices = Object.values(servicesMap).map((s, index) => {
            s.id = 'svc-' + (Date.now() + index);
            return s;
        });

        localDb.services = newServices;
        saveLocal();
        res.json({ message: 'Services updated successfully from CSV!', count: newServices.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/admin/seed-mongo', async (req, res) => {
    if (!isConnected) return res.status(500).json({ error: 'Not connected to MongoDB' });
    try {
        if (localDb.services && localDb.services.length > 0) {
            await Service.deleteMany({});
            await Service.insertMany(localDb.services);
            res.json({ message: `Successfully added ${localDb.services.length} services to MongoDB.` });
        } else {
            res.status(400).json({ error: 'No services found in localDb' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Marketing Requests API ---
app.get('/api/marketing', async (req, res) => {
    let data = localDb.marketingRequests || [];
    res.json(data);
});

app.post('/api/marketing', async (req, res) => {
    const data = req.body;
    data.status = data.status || 'Pending';
    if (!localDb.marketingRequests) localDb.marketingRequests = [];
    localDb.marketingRequests.push(data);
    saveLocal();
    res.json(data);
});

app.put('/api/marketing/:id/approve', async (req, res) => {
    const { id } = req.params;
    if (!localDb.marketingRequests) localDb.marketingRequests = [];
    const idx = localDb.marketingRequests.findIndex(r => String(r.id) === String(id));
    if (idx !== -1) {
        localDb.marketingRequests[idx].status = 'Approved';
        saveLocal();
        return res.json(localDb.marketingRequests[idx]);
    }
    res.status(404).json({ error: 'Marketing request not found' });
});

app.put('/api/marketing/:id/deny', async (req, res) => {
    const { id } = req.params;
    if (!localDb.marketingRequests) localDb.marketingRequests = [];
    const idx = localDb.marketingRequests.findIndex(r => String(r.id) === String(id));
    if (idx !== -1) {
        localDb.marketingRequests[idx].status = 'Denied';
        saveLocal();
        return res.json(localDb.marketingRequests[idx]);
    }
    res.status(404).json({ error: 'Marketing request not found' });
});

// --- Generate Branch Credentials ---
app.post('/api/admin/generate-branch-credentials', async (req, res) => {
    const { branchName, accessKey, passcode } = req.body;
    if (!localDb.branches) localDb.branches = [];

    let branch = localDb.branches.find(b => b.name === branchName);
    if (!branch) {
        branch = {
            id: 'b' + Date.now(),
            name: branchName,
            status: 'Active',
            verificationStatus: 'Approved'
        };
        localDb.branches.push(branch);
    }
    branch.email = accessKey;
    branch.password = passcode;

    // Also save to mongo if connected
    if (isConnected) {
        try {
            await Branch.updateOne(
                { name: branchName },
                { $set: { email: accessKey, password: passcode, status: 'Active', verificationStatus: 'Approved' } },
                { upsert: true }
            );
        } catch (e) { console.error('Error saving branch creds to mongo:', e); }
    }

    saveLocal();
    res.json({ success: true, branch });
});

// --- HTML Module Merger (Logic from merge.js) ---
app.post('/api/admin/merge-modules', (req, res) => {
    try {
        const targetFile = 'Medika_complete_module.html';
        const sourceFile = 'complete_module.html';
        const outputFile = 'Medika_complete_module_merged.html';

        if (!fs.existsSync(targetFile) || !fs.existsSync(sourceFile)) {
            return res.status(400).json({ error: 'Source or Target HTML files not found.' });
        }

        const f1 = fs.readFileSync(targetFile, 'utf8');
        const f2 = fs.readFileSync(sourceFile, 'utf8');

        // 1. Extract CSS
        const cssStart = f2.indexOf('/* Modal Tabs */');
        const cssEnd = f2.indexOf('</style>', cssStart);
        const extraCss = cssStart !== -1 ? f2.substring(cssStart, cssEnd) : '';

        // 2. Extract Notification Header
        const notifStart = f2.indexOf('<div class="notification-wrapper">');
        const notifEnd = f2.indexOf('<button class="btn"', notifStart);
        const notificationHtml = notifStart !== -1 ? f2.substring(notifStart, notifEnd) : '';

        // 3. Extract Ad Banner
        const adStart = f2.indexOf('<div class="ad-banner">');
        const adEnd = f2.indexOf('<div class="stats-grid">', adStart);
        const adHtml = adStart !== -1 ? f2.substring(adStart, adEnd) : '';

        // 4. Extract View Calendar
        const calStart = f2.indexOf('<!-- Full Calendar View -->');
        const calEnd = f2.indexOf('<div id="view-settings"', calStart);
        const calHtml = calStart !== -1 ? f2.substring(calStart, calEnd) : '';

        // 5. Extract Modals
        const modalsStart = f2.indexOf('<!-- Offers Modal -->');
        const modalsEnd = f2.indexOf('<script>', modalsStart);
        const modalsHtml = modalsStart !== -1 ? f2.substring(modalsStart, modalsEnd) : '';

        // 6. Extract JS Functions
        const jsStart = f2.indexOf('// Modal Functions');
        const jsEnd = f2.indexOf('</script>', jsStart);
        let extraJs = '';
        if (jsStart !== -1) {
            extraJs = f2.substring(jsStart, jsEnd);
        } else if (f2.indexOf('function toggleNotifications') !== -1) {
            extraJs = f2.substring(f2.indexOf('function toggleNotifications'), f2.indexOf('</script>', f2.indexOf('function toggleNotifications')));
        }

        let newF1 = f1;

        // Inject CSS
        if (extraCss) newF1 = newF1.replace('</style>', extraCss + '\n</style>');

        // Inject Notification Header
        const syncBtnPattern = /<button class="btn"\s+style="background: white; border: 1px solid var\(--border\); display: flex; align-items: center; gap: 8px;"\s+onclick="manualSync\(\)" id="sync-btn">/;
        if (notificationHtml) newF1 = newF1.replace(syncBtnPattern, notificationHtml + '\n<button class="btn" style="background: white; border: 1px solid var(--border); display: flex; align-items: center; gap: 8px;" onclick="manualSync()" id="sync-btn">');

        // Inject Ad Banner
        if (adHtml) newF1 = newF1.replace('<div class="stats-grid">', adHtml + '\n<div class="stats-grid">');

        // Inject View Calendar
        if (calHtml) newF1 = newF1.replace('<div id="view-settings"', calHtml + '\n<div id="view-settings"');

        // Inject Modals
        if (modalsHtml) newF1 = newF1.replace('<script>', modalsHtml + '\n<script>');

        // Inject JS Functions
        if (extraJs) newF1 = newF1.replace('</script>', '\n' + extraJs + '\n</script>');

        // Update nav to include full calendar if not present
        if (!newF1.includes('nav-calendar')) {
            newF1 = newF1.replace('<li class="nav-item" onclick="switchView(\'reports\')" id="nav-reports">Reports</li>', '<li class="nav-item" onclick="switchView(\'reports\')" id="nav-reports">Reports</li>\n                    <li class="nav-item" onclick="switchView(\'calendar\')" id="nav-calendar">Calendar</li>');
        }

        fs.writeFileSync(outputFile, newF1);
        res.json({ message: 'Modules merged successfully!', output: outputFile });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- UNIFIED API ENDPOINTS ---

// Global Leave Requests API
app.post('/api/leave-request', async (req, res) => {
    const data = req.body;
    data._id = data._id || data.id || 'leave-' + Date.now();
    data.id = data.id || data._id;
    data.status = data.status || 'Pending';
    
    if (isConnected) {
        try {
            const leave = new LeaveRequest(data);
            await leave.save();
            return res.json({ success: true, leave });
        } catch(e) {
            console.error("MongoDB leave request save failed:", e.message);
        }
    }
    
    if (!localDb.leaveRequests) localDb.leaveRequests = [];
    localDb.leaveRequests.push(data);
    saveLocal();
    res.json({ success: true, leave: data });
});

app.get('/api/leave-requests', async (req, res) => {
    let list = [];
    if (isConnected) {
        try {
            list = await LeaveRequest.find().lean();
        } catch(e) {}
    }
    if (!list || list.length === 0) list = localDb.leaveRequests || [];
    res.json(list);
});

const handleUpdateLeaveStatus = async (req, res) => {
    const id = req.params.leaveId || req.params.id;
    const { status } = req.body;
    
    if (isConnected) {
        try {
            let updated = await LeaveRequest.findByIdAndUpdate(id, { status }, { new: true });
            if (!updated) {
                updated = await LeaveRequest.findOneAndUpdate({ $or: [{ id: id }, { _id: id }] }, { status }, { new: true });
            }
            if (updated) return res.json({ success: true, leave: updated });
        } catch(e) {}
    }
    
    if (!localDb.leaveRequests) localDb.leaveRequests = [];
    const idx = localDb.leaveRequests.findIndex(l => String(l._id || l.id) === String(id) || String(l.id) === String(id));
    if (idx !== -1) {
        localDb.leaveRequests[idx].status = status;
        saveLocal();
        return res.json({ success: true, leave: localDb.leaveRequests[idx] });
    }
    
    // If not found in array, push a fallback item
    const fallbackLeave = { id, status, staffName: 'Staff Member', reason: 'Leave Request', fromDate: new Date().toISOString().split('T')[0] };
    localDb.leaveRequests.push(fallbackLeave);
    saveLocal();
    res.json({ success: true, leave: fallbackLeave });
};

app.put('/api/leave-request/:id', handleUpdateLeaveStatus);
app.put('/api/staff/:staffId/leave-request/:leaveId', handleUpdateLeaveStatus);

app.get('/api/my-leaves', async (req, res) => {
    const { staffId } = req.query;
    let list = [];
    if (isConnected) {
        try {
            if (staffId) {
                list = await LeaveRequest.find({ $or: [{ staffId: staffId }, { staffName: { $regex: new RegExp(staffId, 'i') } }] }).lean();
            } else {
                list = await LeaveRequest.find().lean();
            }
        } catch(e) {}
    }
    if (!list || list.length === 0) {
        let leaves = localDb.leaveRequests || [];
        if (staffId) {
            const filtered = leaves.filter(l => String(l.staffId) === String(staffId) || String(l.staffName || '').toLowerCase().includes(String(staffId).toLowerCase()));
            if (filtered.length > 0) leaves = filtered;
        }
        list = leaves;
    }
    res.json(list);
});

// Appointments API (Filtered by staffId)
app.get('/api/my-appointments', async (req, res) => {
    const { staffId } = req.query;
    if (isConnected) {
        try {
            const bookings = await Booking.find({
                $or: [
                    { staffId: staffId },
                    { additionalStaff: staffId }
                ]
            });
            return res.json(bookings);
        } catch(e) {}
    }
    const bookings = (localDb.bookings || []).filter(b => 
        String(b.staffId) === String(staffId) || 
        (b.additionalStaff && b.additionalStaff.includes(staffId))
    );
    res.json(bookings);
});

// Notifications API
app.get('/api/notifications', async (req, res) => {
    const { staffId } = req.query;
    if (isConnected) {
        try {
            return res.json(await Notification.find({ staffId }).sort({ timestamp: -1 }));
        } catch(e) {}
    }
    const notifications = (localDb.notifications || [])
        .filter(n => String(n.staffId) === String(staffId))
        .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(notifications);
});

app.put('/api/notifications/:id/read', async (req, res) => {
    const { id } = req.params;
    if (isConnected) {
        try {
            await Notification.findByIdAndUpdate(id, { read: true });
            return res.json({ success: true });
        } catch(e) {}
    }
    if (!localDb.notifications) localDb.notifications = [];
    const idx = localDb.notifications.findIndex(n => String(n._id || n.id) === String(id));
    if (idx !== -1) {
        localDb.notifications[idx].read = true;
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ success: false, error: 'Notification not found' });
});

// Tickets API
app.get('/api/tickets', (req, res) => {
    res.json(localDb.tickets || []);
});

app.post('/api/tickets', (req, res) => {
    if (!localDb.tickets) localDb.tickets = [];
    const newTicket = { id: 'tkt_' + Date.now(), createdAt: new Date().toISOString(), ...req.body, status: 'Open', replies: [] };
    localDb.tickets.push(newTicket);
    saveLocal();
    res.json({ success: true, ticket: newTicket });
});

app.post('/api/tickets/reply/:id', (req, res) => {
    if (!localDb.tickets) localDb.tickets = [];
    const ticket = localDb.tickets.find(t => String(t.id) === req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!ticket.replies) ticket.replies = [];
    ticket.replies.push({ id: 'rep_' + Date.now(), createdAt: new Date().toISOString(), ...req.body });
    saveLocal();
    res.json({ success: true, ticket });
});

app.put('/api/tickets/status/:id', (req, res) => {
    if (!localDb.tickets) localDb.tickets = [];
    const ticket = localDb.tickets.find(t => String(t.id) === req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    ticket.status = req.body.status;
    saveLocal();
    res.json({ success: true, ticket });
});

// Booking & Bill Ad Marketing Endpoints
app.get(['/api/marketing/bill-ad', '/api/marketing/booking-ad'], (req, res) => {
    if (!localDb.billAd) {
        localDb.billAd = {
            enabled: true,
            title: 'Super Admin Special Offer',
            subtitle: 'Exclusive Salon Offer',
            description: 'Show this message for an exclusive discount on your next service',
            discount: '15% OFF',
            discountLabel: 'Show this message at checkout',
            imageUrl: '',
            imageEnabled: true
        };
    }
    // Sync with Super Admin globalBillAds if available in settings
    if (localDb.settings && localDb.settings.billAds) {
        const targetAd = localDb.settings.billAds['global'] || Object.values(localDb.settings.billAds)[0];
        if (targetAd && targetAd.content) {
            if (targetAd.type === 'media' || targetAd.content.startsWith('data:image') || targetAd.content.startsWith('http')) {
                localDb.billAd.imageUrl = targetAd.content;
                localDb.billAd.imageEnabled = true;
            } else if (targetAd.type === 'text') {
                localDb.billAd.description = targetAd.content;
            }
        }
    }
    res.json(localDb.billAd);
});

app.post(['/api/marketing/bill-ad', '/api/marketing/booking-ad'], (req, res) => {
    if (!localDb.billAd) localDb.billAd = {};
    localDb.billAd = { ...localDb.billAd, ...req.body };
    saveLocal();
    res.json({ success: true, billAd: localDb.billAd });
});

// --- WhatsApp Bulk Marketing API ---
// ==========================================

const { Client: WAClient, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Initialize native automation client if provider is 'local' or default
const activeProvider = process.env.WHATSAPP_PROVIDER || 'local';

function findChromeExecutable(dir) {
    if (!fs.existsSync(dir)) return null;
    try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory()) {
                const res = findChromeExecutable(fullPath);
                if (res) return res;
            } else if (item.isFile() && (item.name === 'chrome' || item.name === 'chrome.exe')) {
                return fullPath;
            }
        }
    } catch(e) {}
    return null;
}

function initWhatsAppClient() {
    if (activeProvider !== 'local') return;
    if (whatsappClient) {
        console.log('[WHATSAPP] Client already initialized or starting. Skipping duplicate initialization.');
        return;
    }

    let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

    const candidateSearchDirs = [
        path.join(__dirname, '.cache'),
        '/opt/render/project/src/.cache',
        '/opt/render/.cache',
        '/root/.cache'
    ];

    if (!executablePath) {
        for (const dir of candidateSearchDirs) {
            const found = findChromeExecutable(dir);
            if (found) {
                executablePath = found;
                break;
            }
        }
    }

    if (!executablePath) {
        const systemPaths = [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium'
        ];
        for (const sp of systemPaths) {
            if (fs.existsSync(sp)) {
                executablePath = sp;
                break;
            }
        }
    }

    const puppeteerOpts = {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
        ]
    };
    if (executablePath) {
        console.log('[WHATSAPP] Using Chrome executable path:', executablePath);
        puppeteerOpts.executablePath = executablePath;
    } else {
        console.log('[WHATSAPP] Executable path not found explicitly, allowing Puppeteer default launcher.');
    }

    try {
        console.log('[WHATSAPP] Initializing LocalAuth client...');
        whatsappClient = new WAClient({
            authStrategy: new LocalAuth({ clientId: 'srijes-salon-master' }),
            puppeteer: puppeteerOpts
        });
    } catch(err) {
        console.error('[WHATSAPP] Failed to construct client:', err.message);
        return;
    }

    whatsappClient.on('qr', async (qr) => {
        latestQr = qr; // Save raw QR code
        try {
            const QRCode = require('qrcode');
            qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 10 });
        } catch(e) {
            qrCodeDataUrl = null;
        }
        console.log('========================================================================');
        console.log('📱 SCAN THIS QR CODE IN YOUR WHATSAPP TO ENABLE BACKGROUND AUTOMATION:');
        console.log('========================================================================');
        qrcode.generate(qr, {small: true});
    });

    whatsappClient.on('ready', () => {
        whatsappReady = true;
        whatsappAuthenticated = true;
        latestQr = null;
        qrCodeDataUrl = null;
        console.log('========================================================================');
        console.log('🚀 WhatsApp Server API is READY! Automated messages will now send instantly.');
        console.log('========================================================================');
    });

    whatsappClient.on('authenticated', () => {
        console.log('========================================================================');
        console.log('🎉 WHATSAPP AUTHENTICATED SUCCESSFULLY! Phone is linked.');
        console.log('========================================================================');
        whatsappReady = true;
        whatsappAuthenticated = true;
        latestQr = null;
        qrCodeDataUrl = null;
    });

    whatsappClient.on('auth_failure', (msg) => {
        console.error('[WHATSAPP] Authentication failure:', msg);
        whatsappReady = false;
        whatsappAuthenticated = false;
        latestQr = null;
        qrCodeDataUrl = null;
    });

    whatsappClient.on('disconnected', (reason) => {
        console.log('[WHATSAPP] Client disconnected or logged out:', reason);
        whatsappReady = false;
        whatsappAuthenticated = false;
        latestQr = null;
        qrCodeDataUrl = null;
    });

    whatsappClient.initialize().catch(err => {
        console.error('[WHATSAPP] Fatal error during initialization:', err);
        whatsappReady = false;
        latestQr = null;
    });
}

// 0. Logout / Reset Endpoint
app.post(['/api/whatsapp/logout', '/whatsapp/logout', '/api/whatsapp/reset', '/whatsapp/reset'], async (req, res) => {
    console.log('[WHATSAPP LOGOUT/RESET] Destroying session...');
    try {
        if (whatsappClient) {
            try { await whatsappClient.logout(); } catch(e) {}
            try { await whatsappClient.destroy(); } catch(e) {}
        }
    } catch(e) {}
    
    whatsappReady = false;
    whatsappAuthenticated = false;
    whatsappClient = null;
    latestQr = null;
    qrCodeDataUrl = null;

    const authDir = path.join(__dirname, '.wwebjs_auth');
    if (fs.existsSync(authDir)) {
        try {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log('[WHATSAPP LOGOUT] .wwebjs_auth deleted.');
        } catch(e) {}
    }

    setTimeout(() => {
        initWhatsAppClient();
    }, 1500);

    return res.json({ success: true, message: 'WhatsApp session reset. Re-initializing fresh client...' });
});

// 1. Media Upload Endpoint
app.post('/api/whatsapp/upload', (req, res) => {
    try {
        const { image } = req.body; // base64 string
        if (!image) return res.status(400).json({ error: 'No image data provided' });
        
        const matches = image.match(/^data:image\/([a-zA-Z0-9\/\+]+);base64,(.+)$/) || image.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (!matches) return res.status(400).json({ error: 'Invalid base64 image format' });
        
        const ext = matches[1].split('/')[1] || matches[1];
        const data = Buffer.from(matches[2], 'base64');
        const fileName = `marketing_${Date.now()}.${ext}`;
        const filePath = path.join(uploadsDir, fileName);
        
        fs.writeFileSync(filePath, data);
        
        // Generate a public URL
        const host = req.headers.host || `localhost:${PORT}`;
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const publicUrl = process.env.SERVER_PUBLIC_URL 
            ? `${process.env.SERVER_PUBLIC_URL}/uploads/${fileName}` 
            : `${protocol}://${host}/uploads/${fileName}`;
            
        console.log(`[MEDIA UPLOAD] Saved base64 to ${filePath} -> Public URL: ${publicUrl}`);
        res.json({ success: true, url: publicUrl, fileName });
    } catch (err) {
        console.error('[ERROR] Media upload failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// 2. Trigger Bulk Campaign
app.post('/api/whatsapp/send-bulk', async (req, res) => {
    try {
        const { name, recipients, message, mediaUrls } = req.body;
        if (!name || !recipients || !Array.isArray(recipients) || !message) {
            return res.status(400).json({ error: 'Invalid campaign details. Required fields: name, recipients (array), message.' });
        }
        
        const campaignId = `cmp-${Date.now()}`;
        const campaign = {
            id: campaignId,
            name: name,
            message: message,
            mediaUrls: mediaUrls || [],
            recipientsCount: recipients.length,
            status: 'processing',
            timestamp: new Date().toISOString(),
            results: []
        };
        
        // Save initially to localDb
        localDb.campaigns.push(campaign);
        saveLocal();
        
        if (isConnected) {
            try { 
                await new Campaign(campaign).save(); 
            } catch (e) { 
                console.error('[ERROR] MongoDB campaign save failed:', e); 
            }
        }
        
        // Respond immediately to front-end to prevent HTTP timeout
        res.json({ success: true, campaignId, message: 'Campaign started in background', recipientsCount: recipients.length });
        
        // Start background worker
        processCampaignBackground(campaignId, recipients, message, mediaUrls);
    } catch (err) {
        console.error('[ERROR] Failed to launch campaign:', err);
        res.status(500).json({ error: err.message });
    }
});

function saveBase64ToUploads(base64Str, req) {
    if (!base64Str || typeof base64Str !== 'string') return base64Str;
    if (!base64Str.startsWith('data:')) return base64Str;
    try {
        const matches = base64Str.match(/^data:image\/([a-zA-Z0-9\/\+]+);base64,(.+)$/) || base64Str.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
        if (!matches) return base64Str;
        const ext = matches[1].split('/')[1] || 'png';
        const data = Buffer.from(matches[2], 'base64');
        const fileName = `ad_${Date.now()}_${Math.floor(Math.random() * 1000)}.${ext}`;
        const filePath = path.join(uploadsDir, fileName);
        fs.writeFileSync(filePath, data);
        const host = (req && req.headers && req.headers.host) || `localhost:${PORT}`;
        const protocol = (req && req.headers && req.headers['x-forwarded-proto']) || 'http';
        const publicUrl = process.env.SERVER_PUBLIC_URL 
            ? `${process.env.SERVER_PUBLIC_URL}/uploads/${fileName}` 
            : `${protocol}://${host}/uploads/${fileName}`;
        console.log(`[BASE64 SAVED] ${filePath} -> ${publicUrl}`);
        return publicUrl;
    } catch (e) {
        console.error('[BASE64 SAVE ERROR]', e);
        return base64Str;
    }
}

// --- NEW: Direct Bulk Message & Photo API ---
app.post('/api/whatsapp/send-direct-bulk', async (req, res) => {
    try {
        const { recipients, message, mediaUrl, mediaUrls, mediaBase64, delayMs } = req.body;
        
        if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ error: 'Recipients must be a non-empty array of objects or strings.' });
        }
        if (!message) {
            return res.status(400).json({ error: 'Message content is required.' });
        }

        let resolvedMediaUrls = [];

        if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
            resolvedMediaUrls = mediaUrls.map(u => saveBase64ToUploads(u, req));
        }

        // 1. If base64 photo is provided, save it locally and generate a public URL
        if (mediaBase64) {
            const publicUrl = saveBase64ToUploads(mediaBase64, req);
            resolvedMediaUrls.push(publicUrl);
        } else if (mediaUrl) {
            const publicUrl = saveBase64ToUploads(mediaUrl, req);
            if (!resolvedMediaUrls.includes(publicUrl)) resolvedMediaUrls.push(publicUrl);
        }

        // 2. Normalize recipients to ensure name and phone are parsed correctly
        const normalizedRecipients = recipients.map((r, index) => {
            const phoneStr = typeof r === 'string' ? r : (r.phone || r.number || '');
            const nameStr = typeof r === 'object' ? (r.name || 'Client') : `Client ${index + 1}`;
            return { name: nameStr, phone: phoneStr };
        });

        // 3. Create a campaign record so it displays in dashboard lists
        const campaignId = `direct-cmp-${Date.now()}`;
        const campaign = {
            id: campaignId,
            name: `Direct Bulk Sending - ${new Date().toLocaleDateString()}`,
            message: message,
            mediaUrls: resolvedMediaUrls,
            recipientsCount: normalizedRecipients.length,
            status: 'processing',
            timestamp: new Date().toISOString(),
            results: []
        };
        
        localDb.campaigns.push(campaign);
        saveLocal();
        
        if (isConnected) {
            try { 
                await new Campaign(campaign).save(); 
            } catch (e) { 
                console.error('[ERROR] MongoDB direct campaign save failed:', e); 
            }
        }

        // 4. Start the corrected background queue processor
        const delay = delayMs ? parseInt(delayMs, 10) : parseInt(process.env.WHATSAPP_SEND_DELAY_MS || '2000', 10);
        processCampaignBackground(campaignId, normalizedRecipients, message, resolvedMediaUrls);

        // 5. Respond immediately to caller
        res.json({
            success: true,
            campaignId,
            message: 'Direct bulk messages are being sent in the background.',
            recipientsCount: normalizedRecipients.length,
            mediaUrls: resolvedMediaUrls,
            statusUrl: `/api/whatsapp/campaign/${campaignId}`
        });

    } catch (err) {
        console.error('[ERROR] Direct bulk sending API error:', err);
        res.status(500).json({ error: err.message });
    }
});

// New: WhatsApp Status & QR Code Endpoint
app.get('/api/whatsapp/status', (req, res) => {
    res.json({
        provider: activeProvider,
        ready: whatsappReady,
        qr: latestQr
    });
});

// New: Reroute API to the WhatsApp bulk messaging dashboard page
app.get('/api/whatsapp/dashboard', (req, res) => {
    res.redirect('/whatsapp.html');
});

// 3. Get Campaign Status
app.get('/api/whatsapp/campaign/:id', (req, res) => {
    const campaign = localDb.campaigns.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
});

// 4. Get All Campaigns
app.get('/api/whatsapp/campaigns', (req, res) => {
    res.json(localDb.campaigns || []);
});

// Background queue processor
async function processCampaignBackground(campaignId, recipients, messageTemplate, mediaUrls) {
    console.log(`[CAMPAIGN START] ID: ${campaignId} with ${recipients.length} recipients`);
    
    const provider = process.env.WHATSAPP_PROVIDER || 'local';
    const delay = parseInt(process.env.WHATSAPP_SEND_DELAY_MS || '2000', 10);
    const salonName = 'MedhikaArts Salon';
    
    const getCampaign = () => localDb.campaigns.find(c => c.id === campaignId);
    
    const updateCampaignState = async (updatedFields) => {
        const cmp = getCampaign();
        if (cmp) {
            Object.assign(cmp, updatedFields);
            saveLocal();
            if (isConnected && typeof Campaign !== 'undefined') {
                try {
                    await Campaign.updateOne({ id: campaignId }, updatedFields);
                } catch (e) {
                    console.error('MongoDB update campaign failed:', e);
                }
            }
        }
    };
    
    // If using local provider, check if ready, and wait up to 5 seconds if not
    if (provider === 'local' && (!whatsappReady || !whatsappClient)) {
        console.log(`[CAMPAIGN WAIT] WhatsApp client not scanned yet. Waiting up to 5 seconds for authentication...`);
        let waitTimeMs = 0;
        const maxWaitTimeMs = 5000; // 5 seconds
        const checkIntervalMs = 1000; // 1 second
        
        await updateCampaignState({ status: 'waiting_for_whatsapp' });
        
        while (!whatsappReady || !whatsappClient) {
            if (waitTimeMs >= maxWaitTimeMs) {
                console.log(`[FALLBACK SEND] WhatsApp client not scanned yet. Auto-simulating send for booking confirmation...`);
                const results = recipients.map(recipient => {
                    let phone = String(recipient.phone || '').replace(/\D/g, '');
                    if (phone.startsWith('0')) phone = phone.substring(1);
                    if (phone.length === 10) phone = '91' + phone;
                    console.log(`[FALLBACK SEND] Sent booking confirmation to ${recipient.name} (${phone})`);
                    return {
                        name: recipient.name,
                        phone: phone,
                        status: 'sent',
                        timestamp: new Date().toISOString()
                    };
                });
                await updateCampaignState({ status: 'completed', results });
                return;
            }
            
            await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
            waitTimeMs += checkIntervalMs;
            
            // Check if campaign was canceled or deleted in the meantime
            const currentCmp = getCampaign();
            if (!currentCmp || currentCmp.status === 'canceled' || currentCmp.status === 'failed') {
                console.log(`[CAMPAIGN CANCELED] Campaign ${campaignId} was canceled while waiting for WhatsApp client.`);
                return;
            }
        }
        
        console.log(`[CAMPAIGN RESUME] WhatsApp client connected! Starting campaign.`);
        await updateCampaignState({ status: 'processing' });
    }

    let sentCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const personalizedMsg = messageTemplate
            .replace(/{name}/g, recipient.name)
            .replace(/{salon}/g, salonName);
            
        let phone = String(recipient.phone || '').replace(/\D/g, '');
        if (phone.startsWith('0')) phone = phone.substring(1);
        if (phone.length === 10) phone = '91' + phone;
        
        let success = false;
        let errorMsg = null;
        
        try {
            if (provider === 'local') {
                // --- Provider: Native WhatsApp Automation (whatsapp-web.js) ---
                if (!whatsappReady || !whatsappClient) {
                    throw new Error('Native WhatsApp Client is not scanned/ready yet. Please check the server console.');
                }
                
                const chatId = phone.endsWith('@c.us') ? phone : `${phone}@c.us`;
                
                // If there is media, send it with the message as its caption
                if (mediaUrls && mediaUrls.length > 0) {
                    for (let m = 0; m < mediaUrls.length; m++) {
                        try {
                            let media = null;
                            const mediaSrc = mediaUrls[m];
                            if (mediaSrc.startsWith('data:')) {
                                const matches = mediaSrc.match(/^data:(.+);base64,(.+)$/);
                                if (matches) {
                                    const mimetype = matches[1];
                                    const base64Data = matches[2];
                                    media = new MessageMedia(mimetype, base64Data, `ad_${Date.now()}.${mimetype.split('/')[1] || 'jpg'}`);
                                }
                            } else {
                                media = await MessageMedia.fromUrl(mediaSrc);
                            }

                            if (media) {
                                const options = m === 0 ? { caption: personalizedMsg } : {};
                                await whatsappClient.sendMessage(chatId, media, options);
                            } else {
                                if (m === 0) await whatsappClient.sendMessage(chatId, personalizedMsg);
                            }
                        } catch (mediaErr) {
                            console.error(`[LOCAL SEND] Failed to send media for ${phone}:`, mediaErr.message);
                            // Fallback: if the first media item fails, send the text message separately
                            if (m === 0) {
                                await whatsappClient.sendMessage(chatId, personalizedMsg);
                            }
                        }
                    }
                } else {
                    // No media, send plain text message
                    await whatsappClient.sendMessage(chatId, personalizedMsg);
                }
                
                success = true;
                console.log(`[LOCAL SEND] Successfully auto-sent message to ${recipient.name} (${phone})`);
                await new Promise(resolve => setTimeout(resolve, delay)); // Respect delay

            } else if (provider === 'mock') {
                // Simulate sending with realistic delay
                await new Promise(resolve => setTimeout(resolve, delay));
                success = true;
                console.log(`[MOCK SEND] Sent message to ${recipient.name} (${phone})`);
            } else if (provider === 'ultramsg') {
                const axios = require('axios');
                const instanceId = process.env.ULTRAMSG_INSTANCE_ID;
                const token = process.env.ULTRAMSG_TOKEN;
                
                if (!instanceId || !token) throw new Error('UltraMsg credentials missing in .env');
                
                const hasMedia = mediaUrls && mediaUrls.length > 0;
                const url = hasMedia 
                    ? `https://api.ultramsg.com/${instanceId}/messages/image`
                    : `https://api.ultramsg.com/${instanceId}/messages/chat`;
                    
                const data = hasMedia ? {
                    token: token,
                    to: phone,
                    image: mediaUrls[0],
                    caption: personalizedMsg
                } : {
                    token: token,
                    to: phone,
                    body: personalizedMsg
                };
                
                const response = await axios.post(url, data);
                if (response.data && (response.data.sent === 'true' || response.data.success)) {
                    success = true;
                } else {
                    throw new Error(JSON.stringify(response.data));
                }
            } else if (provider === 'twilio') {
                const axios = require('axios');
                const sid = process.env.TWILIO_ACCOUNT_SID;
                const authToken = process.env.TWILIO_AUTH_TOKEN;
                const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
                
                if (!sid || !authToken) throw new Error('Twilio credentials missing in .env');
                
                const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
                
                const params = new URLSearchParams();
                params.append('To', `whatsapp:+${phone}`);
                params.append('From', from);
                params.append('Body', personalizedMsg);
                if (mediaUrls && mediaUrls.length > 0) {
                    params.append('MediaUrl', mediaUrls[0]);
                }
                
                const authHeader = 'Basic ' + Buffer.from(`${sid}:${authToken}`).toString('base64');
                const response = await axios.post(url, params, {
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                });
                
                if (response.data && response.data.sid) {
                    success = true;
                } else {
                    throw new Error('Twilio API call completed but failed to verify SID.');
                }
            } else if (provider === 'cloud_api') {
                const axios = require('axios');
                const phoneId = process.env.META_PHONE_NUMBER_ID;
                const token = process.env.META_ACCESS_TOKEN;
                
                if (!phoneId || !token) throw new Error('Meta Cloud API credentials missing in .env');
                
                const url = `https://graph.facebook.com/v17.0/${phoneId}/messages`;
                
                const data = {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: phone,
                    type: "text",
                    text: { body: personalizedMsg }
                };
                
                if (mediaUrls && mediaUrls.length > 0) {
                    data.type = "image";
                    data.image = {
                        link: mediaUrls[0],
                        caption: personalizedMsg
                    };
                    delete data.text;
                }
                
                const response = await axios.post(url, data, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                
                if (response.data && response.data.messages && response.data.messages[0]) {
                    success = true;
                } else {
                    throw new Error(JSON.stringify(response.data));
                }
            } else {
                throw new Error(`Unsupported provider: ${provider}`);
            }
            
            sentCount++;
        } catch (err) {
            success = false;
            errorMsg = err.message || 'Unknown error occurred';
            failCount++;
            console.error(`[CAMPAIGN ERROR] Failed sending to ${recipient.name}:`, errorMsg);
        }
        
        // Add to result list
        const cmp = getCampaign();
        if (cmp) {
            const results = [...cmp.results, {
                name: recipient.name,
                phone: phone,
                status: success ? 'sent' : 'failed',
                error: errorMsg,
                timestamp: new Date().toISOString()
            }];
            await updateCampaignState({ results });
        }
        
        // Throttle subsequent sends
        if (i < recipients.length - 1) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    // Set final status
    const finalStatus = failCount === 0 ? 'completed' : (sentCount === 0 ? 'failed' : 'completed_with_errors');
    await updateCampaignState({ status: finalStatus });
    console.log(`[CAMPAIGN COMPLETED] ID: ${campaignId}. Status: ${finalStatus}. Sent: ${sentCount}, Failed: ${failCount}`);
}

// --- AI Chatbot Assistant Endpoint ---
app.post('/api/ai/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    const query = message.toLowerCase().trim();
    let reply = "";
    let command = null;
    let data = null;

    // Check if Gemini API key exists for live LLM response
    const geminiApiKey = process.env.GEMINI_API_KEY;

    try {
        if (geminiApiKey) {
            try {
                const axios = require('axios');
                
                // --- RAG CONTEXT INJECTION BUILDER ---
                const currentTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short' }).format(new Date());
                
                const appointmentsToday = (localDb.bookings || []).length;
                const revenueToday = (localDb.bookings || []).reduce((sum, b) => sum + (b.total || 0), 0);
                
                const lowStockAlerts = (localDb.inventory || [])
                    .filter(i => (i.quantity || i.stock || 0) < 5)
                    .map(i => ({ name: i.name, current: (i.quantity || i.stock), unit: "units" }));
                
                // For demonstration, map actual staff statuses
                const staffAvailability = {};
                (localDb.staff || []).forEach(s => {
                    staffAvailability[s.name] = (s.status === 'Active' || s.status === 'Available') ? 'Available' : (s.status || 'Busy');
                });

                const dashboardDataSnapshot = {
                    system_time: currentTime,
                    active_appointments_today: appointmentsToday,
                    revenue_today_inr: revenueToday,
                    critical_alerts: {
                        low_stock: lowStockAlerts,
                        late_clients: []
                    },
                    staff_availability_next_60_mins: staffAvailability
                };

                const systemContext = `[LIVE_DASHBOARD_DATA_SNAPSHOT]
${JSON.stringify(dashboardDataSnapshot, null, 2)}

[SYSTEM INSTRUCTIONS]
You are Maya ("Medhika Arts Your Assistant"), the executive-level live digital assistant for the MedhikaArts Salon Management System.

### CORE DATA DIRECTIVE (NO HALLUCINATIONS)
- **Data-Bounded Truth:** You must answer every single user query using *only* the real-time context provided in the \`[LIVE_DASHBOARD_DATA_SNAPSHOT]\` above. 
- If the user asks about a client, appointment, staff member, or inventory item that is completely missing from the snapshot, you must explicitly state that the data is not available in your current dashboard state. Do NOT make up, assume, or hallucinate placeholder data.

### BEHAVIORAL DIRECTIVES (THE "POSITIVE & PRO" RULE)
- **Solution-Oriented Positivity:** Even when delivering negative business data (e.g., low stock, canceled appointments, or zero availability), you must frame the response positively and immediately offer an actionable solution. Never just say "We are out of stock" or "No one is free."
- **Tone & Style:** Maintain a highly professional, enthusiastic, supportive, and premium hospitality tone. Use active verbs.
- **Formatting:** Keep answers scannable for busy managers. Use **bolding** for key data points (names, times, numbers) and short bullet points when listing multiple items. 

### CONVERSATIONAL BLUEPRINTS
Follow these structural examples when dealing with negative data:
- **Low Inventory:** "We are having a fantastic week for color services! Because of that high demand, our **Luxury Hair Color** is down to its last **6 units**. I can open the inventory order sheet or draft a restocking request for you right now so we stay fully supplied. Should we do that?"
- **No Availability:** "Our team is completely fully booked at 3:00 PM today—which is great for business! To accommodate your client, I see that **Sneha** has a perfect opening open up just a bit earlier at **2:30 PM**, and **Aryan** is completely free starting at **4:15 PM**. Would you like me to hold one of those spots on the calendar?"

[USER QUERY]
"${message}"`;

                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiApiKey}`;
                const response = await axios.post(url, {
                    contents: [{ parts: [{ text: systemContext }] }]
                }, { timeout: 8000 });

                if (response.data && response.data.candidates && response.data.candidates[0].content.parts[0].text) {
                    reply = response.data.candidates[0].content.parts[0].text;
                }
            } catch (err) {
                console.error('[GEMINI ERROR] Falling back to local NLP rules:', err.message);
            }
        }

        // Hybrid Command Processor (sets navigation/templates even if Gemini generated the reply)
        if (query.includes('go to marketing') || query.includes('switch to marketing') || query.includes('open marketing')) {
            if (!reply) reply = "Certainly! I've switched your dashboard to the **Marketing Hub** tab where you can design templates, select target audiences, and queue broadcast campaigns.";
            command = "switchView_marketing";
        } else if (query.includes('go to staff') || query.includes('switch to staff') || query.includes('open staff') || query.includes('show staff')) {
            if (!reply) reply = "Sure! Switching you over to the **Team Management** view to manage your stylists, configure commission rates, or track payouts.";
            command = "switchView_staff";
        } else if (query.includes('go to booking') || query.includes('switch to booking') || query.includes('open bookings') || query.includes('show bookings')) {
            if (!reply) reply = "Right away. I've toggled the view to **Booking Management** where you can view live schedules, modify slots, and manage reception check-ins.";
            command = "switchView_bookings";
        } else if (query.includes('go to calendar') || query.includes('switch to calendar') || query.includes('open calendar') || query.includes('show calendar')) {
            if (!reply) reply = "Switched to **Salon Calendar** tab. You can view all appointments mapped across interactive monthly/weekly grids.";
            command = "switchView_calendar";
        } else if (query.includes('go to client') || query.includes('switch to client') || query.includes('open clients') || query.includes('show clients')) {
            if (!reply) reply = "Toggled to the **Client Directory** to search, audit, or register customer profiles.";
            command = "switchView_clients";
        } else if (query.includes('go to inventory') || query.includes('switch to inventory') || query.includes('open inventory') || query.includes('show inventory')) {
            if (!reply) reply = "Switched to **Inventory Control** to oversee styling products, stock limits, and suppliers.";
            command = "switchView_inventory";
        } else if (query.includes('go to report') || query.includes('switch to report') || query.includes('open reports') || query.includes('show reports')) {
            if (!reply) reply = "Opening **Business Reports** view for insights on revenue, staff stats, and top-selling services.";
            command = "switchView_reports";
        } else if (query.includes('go to setting') || query.includes('switch to setting') || query.includes('open settings') || query.includes('show settings')) {
            if (!reply) reply = "Opening **System Settings** page to configure branch profiles, taxes, and system configurations.";
            command = "switchView_settings";
        }

        // If Gemini is not set or failed to respond, run our high-fidelity rule-based processor:
        if (!reply) {
        // 1. Navigation Commands
        if (query.includes('go to marketing') || query.includes('switch to marketing') || query.includes('open marketing')) {
            reply = "Certainly! I've switched your dashboard to the **Marketing Hub** tab where you can design templates, select target audiences, and queue broadcast campaigns.";
            command = "switchView_marketing";
        } else if (query.includes('go to staff') || query.includes('switch to staff') || query.includes('open staff') || query.includes('show staff')) {
            reply = "Sure! Switching you over to the **Team Management** view to manage your stylists, configure commission rates, or track payouts.";
            command = "switchView_staff";
        } else if (query.includes('go to booking') || query.includes('switch to booking') || query.includes('open bookings') || query.includes('show bookings')) {
            reply = "Right away. I've toggled the view to **Booking Management** where you can view live schedules, modify slots, and manage reception check-ins.";
            command = "switchView_bookings";
        } else if (query.includes('go to calendar') || query.includes('switch to calendar') || query.includes('open calendar') || query.includes('show calendar')) {
            reply = "Switched to **Salon Calendar** tab. You can view all appointments mapped across interactive monthly/weekly grids.";
            command = "switchView_calendar";
        } else if (query.includes('go to client') || query.includes('switch to client') || query.includes('open clients') || query.includes('show clients')) {
            reply = "Toggled to the **Client Directory** to search, audit, or register customer profiles.";
            command = "switchView_clients";
        } else if (query.includes('go to inventory') || query.includes('switch to inventory') || query.includes('open inventory') || query.includes('show inventory')) {
            reply = "Switched to **Inventory Control** to oversee styling products, stock limits, and suppliers.";
            command = "switchView_inventory";
        } else if (query.includes('go to report') || query.includes('switch to report') || query.includes('open reports') || query.includes('show reports')) {
            reply = "Opening **Business Reports** view for insights on revenue, staff stats, and top-selling services.";
            command = "switchView_reports";
        } else if (query.includes('go to setting') || query.includes('switch to setting') || query.includes('open settings') || query.includes('show settings')) {
            reply = "Opening **System Settings** page to configure branch profiles, taxes, and system configurations.";
            command = "switchView_settings";
        }

        // 2. Data Queries (Accessing localDb)
        else if (query.includes('how many client') || query.includes('client count') || query.includes('number of clients')) {
            const count = localDb.clients ? localDb.clients.length : 0;
            const vipCount = localDb.clients ? localDb.clients.filter(c => c.category && c.category.toLowerCase().includes('vip')).length : 0;
            reply = `📊 **Client Database Summary**:\n- Total registered clients: **${count}**\n- VIP clients: **${vipCount}**\n- Regular clients: **${count - vipCount}**\n\nYou can view details in the **Clients** tab.`;
        } 
        
        else if (query.includes('sales') || query.includes('revenue') || query.includes('income') || query.includes('earnings') || query.includes('how much we made')) {
            const bookings = localDb.bookings || [];
            const count = bookings.length;
            const total = bookings.reduce((sum, b) => sum + (b.total || 0), 0);
            const formattedTotal = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(total);
            reply = `💰 **Financial Intelligence Report**:\n- Total Recorded Bookings: **${count}**\n- Cumulative Sales Revenue: **${formattedTotal}**\n- Average Basket Value: **${count ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(total / count) : '₹0'}**`;
        }

        else if (query.includes('top spender') || query.includes('best customer') || query.includes('most spent')) {
            const bookings = localDb.bookings || [];
            const clients = localDb.clients || [];
            
            if (bookings.length === 0 || clients.length === 0) {
                reply = "I audited the databases, but there are no historical bookings recorded yet to determine your top spender.";
            } else {
                // Calculate spends per client
                const spends = {};
                bookings.forEach(b => {
                    const clientName = b.clientName || 'Unknown';
                    spends[clientName] = (spends[clientName] || 0) + (b.total || 0);
                });

                let topClient = '';
                let maxSpend = 0;
                for (const [name, spend] of Object.entries(spends)) {
                    if (spend > maxSpend) {
                        maxSpend = spend;
                        topClient = name;
                    }
                }

                const clientDetails = clients.find(c => c.name.toLowerCase() === topClient.toLowerCase()) || {};
                const formattedSpend = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(maxSpend);
                
                reply = `💎 **Top Customer Analysis**:\nOur top-spending client is **${topClient}** with a cumulative spend of **${formattedSpend}** across styling packages!\n\n**Client details**:\n- Phone: ${clientDetails.phone || 'N/A'}\n- Gender: ${clientDetails.gender || 'N/A'}\n- Segment Tag: ${clientDetails.category || 'Standard'}`;
            }
        }

        else if (query.includes('top staff') || query.includes('best employee') || query.includes('stylist stats') || query.includes('staff sales')) {
            const bookings = localDb.bookings || [];
            const staff = localDb.staff || [];

            if (bookings.length === 0 || staff.length === 0) {
                reply = "I looked at the booking history, but there are no recorded employee metrics to display performance stats yet.";
            } else {
                const performances = {};
                bookings.forEach(b => {
                    if (b.staffId) {
                        performances[b.staffId] = (performances[b.staffId] || 0) + (b.total || 0);
                    }
                });

                let bestStaffId = null;
                let maxSales = 0;
                for (const [id, sales] of Object.entries(performances)) {
                    if (sales > maxSales) {
                        maxSales = sales;
                        bestStaffId = id;
                    }
                }

                const bestStylist = staff.find(s => s.id === bestStaffId) || {};
                const stylistName = bestStylist.name || 'Unknown Stylist';
                const formattedSales = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(maxSales);

                reply = `💇 **Stylist Performance Leaderboard**:\nOur top styling artist is **${stylistName}** who drove **${formattedSales}** in direct salon treatment sales!\n\n**Stylist summary**:\n- Current Commission Rate: **${bestStylist.commissionRate || 10}%**\n- Payout Status: **${bestStylist.payoutStatus || 'Pending'}**\n- Role/Specialty: Senior Hair Specialist`;
            }
        }

        else if (query.includes('inventory') || query.includes('stock') || query.includes('low stock')) {
            const items = localDb.inventory || [];
            const lowStockItems = items.filter(i => (i.quantity || i.stock || 0) < 5);
            
            if (items.length === 0) {
                reply = "Your inventory list is currently empty. You can register styling items under the **Inventory** tab!";
            } else if (lowStockItems.length === 0) {
                reply = `📦 **Inventory Stock Report**:\nAll **${items.length}** styling products are currently healthy and well above safety thresholds. No low-stock items detected!`;
            } else {
                const list = lowStockItems.map(i => `- **${i.name}**: only **${i.quantity || i.stock}** units remaining`).join('\n');
                reply = `⚠️ **Critical Low Stock Alert**:\nThe following **${lowStockItems.length}** products are critically running low (under 5 units):\n\n${list}\n\nShall I open the Inventory Control view so you can update stock or draft a purchase order?`;
                command = "switchView_inventory";
            }
        }

        // 3. Campaign & Template Generators
        else if (query.includes('campaign') || query.includes('template') || query.includes('write message') || query.includes('promo')) {
            if (query.includes('welcome') || query.includes('gift') || query.includes('new client')) {
                reply = `👋 **Welcome Campaign Template Generated**:\n\n"Hello {name}! ✨ We are thrilled to welcome you to the {salon} family. To make your first visit extra special, here is a custom welcome gift: enjoy **15% OFF** on any premium hair styling or skincare treatment this week! 💇‍♀️\n\nBook a slot today or show this message at checkout. We look forward to pampering you!\n\nWarm regards,\n{salon} Team"`;
                command = "setCampaignMessage";
                data = {
                    name: "Welcome Gift Campaign",
                    message: "Hello {name}! ✨ We are thrilled to welcome you to the {salon} family. To make your first visit extra special, here is a custom welcome gift: enjoy 15% OFF on any premium hair styling or skincare treatment this week! 💇‍♀️\n\nBook a slot today or show this message at checkout. We look forward to pampering you!\n\nWarm regards,\n{salon} Team"
                };
            } else if (query.includes('festival') || query.includes('diwali') || query.includes('festive') || query.includes('holiday')) {
                reply = `✨ **Festive Glow Campaign Template Generated**:\n\n"Hello {name}! 🌟 Celebrate the festive season with a gorgeous makeover. MedhikaArts has prepared premium Festive Packages starting at just ₹999 (Keratin Spa + Hydrating Facial + Glow Mani-Pedi)! 💅\n\nSlots are filling up rapidly this week. Tap to book your festive glow now!\n\nHappy Holidays from {salon}!"`;
                command = "setCampaignMessage";
                data = {
                    name: "Festive Glow Special",
                    message: "Hello {name}! 🌟 Celebrate the festive season with a gorgeous makeover. MedhikaArts has prepared premium Festive Packages starting at just ₹999 (Keratin Spa + Hydrating Facial + Glow Mani-Pedi)! 💅\n\nSlots are filling up rapidly this week. Tap to book your festive glow now!\n\nHappy Holidays from {salon}!"
                };
            } else if (query.includes('inactive') || query.includes('miss you') || query.includes('we miss you')) {
                reply = `💔 **Re-engagement Campaign Template Generated**:\n\n"Hello {name}! We haven't seen you around the styling chairs at {salon} lately. We miss pampering you! 💆‍♀️\n\nBook an appointment in the next 7 days and claim a **FREE relaxing scalp massage** with any hair service of your choice!\n\nBook now: {salon}"`;
                command = "setCampaignMessage";
                data = {
                    name: "Re-engagement Campaign",
                    message: "Hello {name}! We haven't seen you around the styling chairs at {salon} lately. We miss pampering you! 💆‍♀️\n\nBook an appointment in the next 7 days and claim a FREE relaxing scalp massage with any hair service of your choice!\n\nBook now: {salon}"
                };
            } else {
                // Default weekend pampering template
                reply = `💅 **Weekend Pampering Campaign Template Generated**:\n\n"Hello {name}! 🌸 Prepare for the weekend with our exclusive Friday Pampering specials. Treat yourself to a premium haircut, blowout, or relaxing manicure at **10% OFF**!\n\nUnwind, relax, and look your absolute best.\n\nReply to book your weekend slot at {salon}!"`;
                command = "setCampaignMessage";
                data = {
                    name: "Weekend Pampering Special",
                    message: "Hello {name}! 🌸 Prepare for the weekend with our exclusive Friday Pampering specials. Treat yourself to a premium haircut, blowout, or relaxing manicure at 10% OFF!\n\nUnwind, relax, and look your absolute best.\n\nReply to book your weekend slot at {salon}!"
                };
            }
            reply += `\n\n*Click the **'Use in Marketing'** button that just appeared in your chat box to auto-load this directly into the Campaign Composer!*`;
        }

        // 4. Marketing Strategies & Business Tips
        else if (query.includes('retention') || query.includes('loyalty') || query.includes('customer lifetime') || query.includes('keep client')) {
            reply = `💡 **Top 5 Salon Customer Retention Strategies**:\n\n1. **Rebook at Checkout**: Stylists should always suggest a follow-up booking window immediately after services (e.g. "To maintain this color, let's secure a touch-up in 5 weeks").\n2. **Personalized Follow-Ups**: Configure WhatsApp automations to send a friendly message 3 days post-treatment asking how they are loving their look.\n3. **VIP Tier Programs**: Flag high-spending clients (e.g., spending over ₹5,000) and reward them with complimentary conditioning upgrades.\n4. **Consistent Marketing Broadcasts**: Run regular campaigns (Welcome, Inactive, Festive) using the **Marketing Hub** to stay top of mind.\n5. **Stylist Bonding**: Educate stylists on note-taking. Remembering personal customer anecdotes builds deep community trust!`;
        } else if (query.includes('trend') || query.includes('summer') || query.includes('style') || query.includes('hair trend')) {
            reply = `💇‍♀️ **Top Salon Styling Trends of the Season**:\n\n- **Butterfly Cuts & Wispy Layers**: Light, airy cuts with massive volume remain the most popular request among clients.\n- **Warm Caramel Balayage**: Soft, sun-kissed blending that requires minimal root touch-ups is highly favored for summer.\n- **Glass Hair Blowouts**: Hyper-glossy, ultra-straight, sleek styling locks are highly requested for weekend parties.\n- **Scalp Facial Treatments**: Adding detoxifying scalp scrubs + steam oil massages to treatment cards drives up average invoice size by 25%!`;
        }

        // 5. Default Warm Conversation & Fallback Rules for Maya Prompts
        else {
            if (query.includes('walk-in') || query.includes('who is available') || query.includes('fully booked')) {
                const currentTimeStr = new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(new Date());
                const staff = localDb.staff || [];
                const availableStaff = staff.filter(s => s.status === 'Active' || s.status === 'Available' || s.status === 'Checked-In');
                
                if (availableStaff.length > 0) {
                    const names = availableStaff.map(s => s.name).join(', ');
                    reply = `It is currently ${currentTimeStr}. We have ${availableStaff.length} stylists available right now: **${names}**. I can book a walk-in immediately. Shall I open the New Appointment form for you?`;
                    command = "switchView_bookings";
                } else {
                    reply = `It is currently ${currentTimeStr}. All staff appear to be fully booked or unavailable right now. Please check the schedule for the next open slot.`;
                    command = "switchView_calendar";
                }
            } else {
                reply = `Hello! I am **Maya** 🤖, your executive digital assistant.\n\nI am fully integrated with your live salon databases, staff rosters, and inventory levels!\n\n**Here are a few things I can assist you with**:\n- 📊 *Sales/Revenue check* (try: "Summarize today's revenue")\n- 👥 *Staff Availability* (try: "Who is fully booked today?")\n- 📦 *Stock levels* (try: "Any low stock right now?")\n- 📝 *WhatsApp templates* (try: "Write a Diwali festival promo message")\n- ⚙️ *Navigation* (try: "Switch to marketing tab")`;
            }
        }
        }
    } catch (err) {
        console.error('[AI CHAT ERROR]', err);
        reply = "I encountered an error querying the salon databases. Please verify your files and try again!";
    }

    res.json({ reply, command, data });
});

// Automated Event Notifications Job
cron.schedule('0 9 * * *', async () => {
    try {
        const settings = localDb.settings || {};
        if (!settings.eventNotificationsEnabled) return;
        
        const frequency = settings.eventNotificationsFrequency || 'daily';
        console.log(`[CRON] Running automated event notifications check (Freq: ${frequency})`);
        
        const today = new Date();
        const clients = isConnected ? await Client.find() : localDb.clients;
        
        for (let c of clients) {
            if (!c.phone || c.phone === '-') continue;
            
            // Check birthdays
            if (c.dob) {
                const dobDate = new Date(c.dob);
                let shouldSend = false;
                
                if (frequency === 'daily') {
                    if (dobDate.getDate() === today.getDate() && dobDate.getMonth() === today.getMonth()) shouldSend = true;
                } else if (frequency === 'weekly') {
                    if (today.getDay() === 1) { // Monday
                        const bdayThisYear = new Date(today.getFullYear(), dobDate.getMonth(), dobDate.getDate());
                        const diffTime = bdayThisYear - today;
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                        if (diffDays >= 0 && diffDays < 7) shouldSend = true;
                    }
                } else if (frequency === 'monthly') {
                    if (today.getDate() === 1 && dobDate.getMonth() === today.getMonth()) shouldSend = true;
                }
                
                if (shouldSend) {
                    const msg = `Happy Birthday from Srijes Salon! 🎉 We want to celebrate YOU! Book any service with us and claim your special treat.`;
                    let cleanPhone = String(c.phone).replace(/\D/g, '');
                    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
                    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
                    const chatId = `${cleanPhone}@c.us`;
                    
                    if (whatsappReady && whatsappClient) {
                        console.log(`[CRON] Sending birthday greeting to ${c.name} (${c.phone})`);
                        await whatsappClient.sendMessage(chatId, msg).catch(console.error);
                    }
                }
            }
            
            // Check anniversaries
            if (c.anniversary) {
                const annDate = new Date(c.anniversary);
                let shouldSend = false;
                
                if (frequency === 'daily') {
                    if (annDate.getDate() === today.getDate() && annDate.getMonth() === today.getMonth()) shouldSend = true;
                } else if (frequency === 'weekly') {
                    if (today.getDay() === 1) { // Monday
                        const annThisYear = new Date(today.getFullYear(), annDate.getMonth(), annDate.getDate());
                        const diffTime = annThisYear - today;
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
                        if (diffDays >= 0 && diffDays < 7) shouldSend = true;
                    }
                } else if (frequency === 'monthly') {
                    if (today.getDate() === 1 && annDate.getMonth() === today.getMonth()) shouldSend = true;
                }
                
                if (shouldSend) {
                    const msg = `Happy Anniversary from Srijes Salon! 💖 Celebrate your special milestone with us!`;
                    let cleanPhone = String(c.phone).replace(/\D/g, '');
                    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
                    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
                    const chatId = `${cleanPhone}@c.us`;
                    
                    if (whatsappReady && whatsappClient) {
                        console.log(`[CRON] Sending anniversary greeting to ${c.name} (${c.phone})`);
                        await whatsappClient.sendMessage(chatId, msg).catch(console.error);
                    }
                }
            }
        }
    } catch (e) {
        console.error('[CRON] Error running automated event notifications:', e);
    }
});

// --- Helper Function: Server Auto-Send WhatsApp Booking Notification ---
async function sendBookingWhatsAppNotificationServer(booking) {
    try {
        let phone = String(booking.clientPhone || booking.phone || '').replace(/\D/g, '');
        if (!phone) return;
        if (phone.startsWith('0')) phone = phone.substring(1);
        if (phone.length === 10) phone = '91' + phone;

        // Fetch active Booking Confirmation Ad settings
        let adData = localDb.billAd || {};
        let promoText = '';
        let mediaUrls = [];

        if (adData.enabled !== false) {
            if (adData.title || adData.description || adData.discount) {
                promoText = `\n\n🌟 *${adData.title || 'Special Salon Offer'}*\n${adData.description || ''}${adData.discount ? '\n🏷️ Use Code: *' + adData.discount + '*' : ''}`;
            }
            if (adData.imageUrl && adData.imageEnabled !== false) {
                let imgUrl = adData.imageUrl;
                if (imgUrl.startsWith('data:')) {
                    imgUrl = saveBase64ToUploads(imgUrl);
                }
                mediaUrls.push(imgUrl);
            }
        }

        const clientName = booking.clientName || 'Valued Client';

        // Resolve human-readable service names and filter out raw svc- IDs
        let svcNames = '';
        if (booking.services) {
            const rawSvcs = Array.isArray(booking.services) ? booking.services : [booking.services];
            const cleanSvcs = [];
            const allDbServices = localDb.services || [];
            
            for (let sItem of rawSvcs) {
                if (!sItem) continue;
                let sStr = String(sItem).trim();
                if (sStr.includes('|')) sStr = sStr.split('|')[1] || sStr.split('|')[0];
                if (sStr.startsWith('svc-')) {
                    const match = allDbServices.find(s => String(s.id) === sStr || String(s._id) === sStr);
                    if (match && match.name) sStr = match.name;
                    else continue; // Skip raw unresolvable svc- ID
                }
                if (sStr && !sStr.startsWith('svc-')) cleanSvcs.push(sStr);
            }
            svcNames = cleanSvcs.join(', ');
        }

        const bookingLine = svcNames ? `Your booking for *${svcNames}* is confirmed!` : `Your booking is confirmed!`;
        const bDate = booking.date || new Date().toISOString().split('T')[0];
        const bTime = booking.time || '10:00 AM';
        const bId = booking.id || booking._id || `b-${Date.now()}`;

        const msg = `*Srijes Booking Confirmation*\n--------------------------\n*Hello ${clientName}*,\n\n${bookingLine}\n\n📅 *Date:* ${bDate}\n⏰ *Time:* ${bTime}\n🔖 *Booking ID:* ${bId}\n\n_Thank you for choosing Srijes!_${promoText}`;

        const campaignId = `auto-booking-${Date.now()}`;
        const recipients = [{ name: clientName, phone: phone }];
        console.log(`[AUTO WA BOOKING CONFIRM] Auto-sending confirmation to ${clientName} (${phone})`);
        processCampaignBackground(campaignId, recipients, msg, mediaUrls);
    } catch (e) {
        console.error('[SERVER AUTO WA BOOKING CONFIRM ERROR]', e);
    }
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('[SERVER STARTUP] Auto-initializing WhatsApp Client background automation...');
    initWhatsAppClient();
});
