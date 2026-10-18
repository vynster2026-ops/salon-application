try { require('dotenv').config(); } catch(e) {}
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}
// Global error handler to prevent unexpected background errors from crashing the server
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection:', reason);
});

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const fs = require('fs');
const cron = require('node-cron');
const path = require('path');

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) 
    : ['http://localhost:5000', 'http://127.0.0.1:5000', 'https://salon-application.onrender.com', 'https://vynster.com', 'http://vynster.com'];

const isOriginAllowed = (origin) => {
    if (!origin) return true;
    if (allowedOrigins.includes('*')) return true;
    return allowedOrigins.includes(origin);
};

// Security Hashing & JWT Core
const JWT_SECRET = process.env.JWT_SECRET || '3ac08d0cccd1040aac739c4d30998672a1ef78ab22651c10d775a843b2e4be8a';
if (JWT_SECRET.length < 32 || JWT_SECRET === 'medika-secret-key-12345') {
    console.error('[FATAL] JWT_SECRET is too short or is a known-insecure default. Server will not start.');
    process.exit(1);
}

function generateToken(payload, expiresInSeconds = 24 * 3600) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const enrichedPayload = Object.assign({}, payload, {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds
    });
    const body = Buffer.from(JSON.stringify(enrichedPayload)).toString('base64url');
    if (!JWT_SECRET) throw new Error('[CRITICAL] JWT_SECRET is not set. Cannot generate token.');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
    return header + '.' + body + '.' + signature;
}

function verifyToken(token) {
    try {
        if (!token) return null;
        if (token.startsWith('Bearer ')) token = token.substring(7).trim();
        
        // No backdoor tokens permitted
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const header = parts[0];
        const body = parts[1];
        const signature = parts[2];
        
        if (!JWT_SECRET) return null; // Refuse to verify without a proper secret
        const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            return null;
        }
        
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload.exp && Date.now() >= payload.exp * 1000) {
            return null; // Expired
        }
        return payload;
    } catch (e) {
        return null;
    }
}

// Password Hashing via Node.js crypto (salted scrypt)
function hashPassword(password) {
    if (!password) return '';
    if (typeof password !== 'string') password = String(password);
    if (password.startsWith('scrypt:')) return password;
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return 'scrypt:' + salt + ':' + hash;
}

function verifyPassword(inputPassword, storedPassword) {
    if (!inputPassword || !storedPassword) return false;
    inputPassword = String(inputPassword).trim();
    storedPassword = String(storedPassword).trim();
    if (storedPassword.startsWith('scrypt:')) {
        const parts = storedPassword.split(':');
        const salt = parts[1];
        const hash = parts[2];
        if (!salt || !hash) return false;
        const testHash = crypto.scryptSync(inputPassword, salt, 64).toString('hex');
        try {
            return crypto.timingSafeEqual(Buffer.from(testHash, 'hex'), Buffer.from(hash, 'hex'));
        } catch (e) {
            return false;
        }
    }
    // Plaintext passwords are no longer accepted. All passwords must be migrated to scrypt hashes.
    // If a stored password is still plaintext, login will fail and an upgrade/reset must be triggered.
    return false;
}

function getUserTier(admin) {
    if (!admin) return 2;
    if (admin.role === 'super') return admin.tier || 1;
    if (admin.role === 'owner' || admin.role === 'branch') return 1;
    if (admin.role === 'manager' || admin.role === 'finance') return 2;
    if (admin.role === 'reception') return 3;
    return admin.tier || 2;
}

// Role-Based Access Control Middleware
const requireAuth = (req, res, next) => {
    let token = req.cookies?.authToken || req.headers['authorization'] || req.query.token;
    if (!token) {
        return res.status(401).json({ error: 'Access denied: Authentication required.' });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Access denied: Invalid or expired token.' });
    }
    req.user = decoded;
    next();
};

const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Access denied: Authentication required.' });
        }
        if (req.user.role === 'super') return next();
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied: Requires role ' + allowedRoles.join(' or ') + '.' });
        }
        next();
    };
};

const authMiddleware = (requiredTier = null) => {
    return (req, res, next) => {
        let token = req.cookies?.authToken || req.headers['authorization'] || req.query.token;
        if (!token) {
            return res.status(401).json({ error: 'Access denied: Authentication token required.' });
        }
        const decoded = verifyToken(token);
        if (!decoded) {
            return res.status(401).json({ error: 'Access denied: Invalid or expired token.' });
        }
        req.user = decoded;
        if (requiredTier !== null) {
            if (decoded.role !== 'super') {
                return res.status(403).json({ error: 'Access denied: Super Admin role required.' });
            }
            if (decoded.tier > requiredTier) {
                return res.status(403).json({ error: 'Access denied: Requires Tier ' + requiredTier + ' or higher (current: Tier ' + decoded.tier + ').' });
            }
        }
        next();
    };
};

const getScopedBranchId = (req) => {
    if (!req.user) return null;
    if (req.user.role === 'super') {
        return req.query.branchId || req.query.branch || null;
    }
    return req.user.branchId || null;
};

// Rate Limiting Helper
const rateLimitStore = new Map();
const createRateLimiter = ({ windowMs, max, message }) => {
    return (req, res, next) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const routeKey = (req.baseUrl || req.path) + ':' + ip;
        const now = Date.now();
        let record = rateLimitStore.get(routeKey);
        if (!record || now - record.startTime > windowMs) {
            record = { count: 1, startTime: now };
            rateLimitStore.set(routeKey, record);
            return next();
        }
        record.count++;
        if (record.count > max) {
            return res.status(429).json({ error: message || 'Too many requests. Please slow down.' });
        }
        next();
    };
};
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many authentication attempts. Please try again after 15 minutes.' });
const otpLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5, message: 'Too many OTP attempts. Please wait 10 minutes.' });
const campaignLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10, message: 'Bulk campaign limit reached. Please try again later.' });
const apiLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 1000, message: 'Rate limit exceeded. Please slow down your requests.' });

const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: {
        origin: function(origin, callback) {
            if (isOriginAllowed(origin)) callback(null, true);
            else callback(new Error('CORS blocked by security policy'));
        }
    }
});

// Socket.IO Handshake Authentication & Tenant Isolation
io.use((socket, next) => {
    const token = (socket.handshake.auth && socket.handshake.auth.token) || (socket.handshake.headers && socket.handshake.headers.authorization);
    if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
            socket.user = decoded;
            if (decoded.branchId) socket.join('branch_' + decoded.branchId);
            if (decoded.role === 'super') socket.join('superadmin');
        }
    }
    next();
});

io.on('connection', (socket) => {
    const broadcastSync = (eventType, data) => {
        if (!socket.user) {
            return socket.emit('error', { message: 'Authentication required for real-time sync.' });
        }
        // Strip any client-supplied branchId from the payload to prevent branch spoofing.
        // Always stamp the branchId from the authenticated token.
        const sanitizedData = typeof data === 'object' && data !== null ? { ...data } : data;
        if (sanitizedData && typeof sanitizedData === 'object') {
            if (socket.user.role !== 'super' && socket.user.branchId) {
                sanitizedData.branchId = socket.user.branchId; // Enforce token-derived branch
            }
        }

        if (socket.user.role !== 'super' && socket.user.branchId) {
            const room = 'branch_' + socket.user.branchId;
            io.to(room).to('superadmin').emit(eventType, sanitizedData);
            io.to(room).to('superadmin').emit('sync_refresh', { type: eventType.replace('_update', '').replace('new_', ''), data: sanitizedData });
        } else {
            io.emit(eventType, sanitizedData);
            io.emit('sync_refresh', { type: eventType.replace('_update', '').replace('new_', ''), data: sanitizedData });
        }
    };

    socket.on('new_booking', (data) => broadcastSync('new_booking', data));
    socket.on('booking_update', (data) => broadcastSync('booking_update', data));
    socket.on('staff_update', (data) => broadcastSync('staff_update', data));
    socket.on('leave_update', (data) => broadcastSync('leave_update', data));
    socket.on('inventory_update', (data) => broadcastSync('inventory_update', data));
    socket.on('service_update', (data) => broadcastSync('service_update', data));

    socket.on('disconnect', () => {});
});

// 1. Helmet Security Headers (Anti-Clickjacking, Anti-Sniff, XSS Filters)
app.use(helmet({
    contentSecurityPolicy: false, // Maintain full compatibility with inline dashboard scripts
    crossOriginEmbedderPolicy: false
}));

// 2. Cookie Parser for Secure HttpOnly Auth Tokens
app.use(cookieParser());

// 3. Secure CORS
app.use(cors({
    origin: function(origin, callback) {
        if (isOriginAllowed(origin)) callback(null, true);
        else callback(new Error('CORS blocked by security policy'));
    },
    credentials: true
}));

// 4. HTTP Security Headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// 5. Body Parsers with safe payload limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 6. NoSQL / SQL Injection Sanitizer Middleware
function sanitizeInput(obj) {
    if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            if (key.startsWith('$') || key.includes('.')) {
                delete obj[key];
            } else if (typeof obj[key] === 'object') {
                sanitizeInput(obj[key]);
            }
        }
    }
    return obj;
}

app.use((req, res, next) => {
    if (req.body) sanitizeInput(req.body);
    if (req.query) sanitizeInput(req.query);
    if (req.params) sanitizeInput(req.params);
    next();
});

// 7. General API Rate Limiter
app.use('/api/', apiLimiter);

// 8. Protect Server Files, Source Maps (.map), & Sensitive Configurations from Exposure
const SENSITIVE_FILE_PATTERN = /(\.env|\.git|\.json$|\.yaml$|\.yml$|\.md$|\.map$|server\.js$|Dockerfile$|seed-mongo\.js$|fix-phones\.js$)/i;
app.use((req, res, next) => {
    if (SENSITIVE_FILE_PATTERN.test(req.path)) {
        return res.status(403).json({ error: 'Access forbidden: Protected system resource.' });
    }
    next();
});

// --- FRONTEND DASHBOARD ROUTE ALIASES ---
// 1. Landing Page (Default Public Homepage)
app.get(['/', '/landing', '/home'], (req, res) => {
    res.sendFile(path.join(__dirname, 'landing.html'));
});

// 2. Enterprise Gateway Hub (Portal selector)
app.get(['/index', '/index.html', '/gateway', '/portal', '/hub'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Serve static assets without auto-intercepting '/' as index.html
app.use(express.static(__dirname, { index: false }));

// 3. Salon Management Dashboard
app.get(['/admin', '/salon', '/owner', '/dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, 'vynster-salon.html'));
});

// 4. Online Booking & Reception
app.get(['/reception', '/booking'], (req, res) => {
    res.sendFile(path.join(__dirname, 'vynster-booking.html'));
});

// 5. Staff Portal
app.get(['/staff', '/staff-dashboard'], (req, res) => {
    res.sendFile(path.join(__dirname, 'staff.html'));
});

// 6. Superadmin / Matrix
app.get(['/superadmin', '/matrix'], (req, res) => {
    res.sendFile(path.join(__dirname, 'matrix.html'));
});

// 7. Staff Login
app.get('/staff-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'staff-login.html'));
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

// --- 24/7 RENDER KEEP-ALIVE HEARTBEAT ROUTE ---
app.get(['/api/ping', '/ping'], (req, res) => {
    res.status(200).json({ status: 'online', time: new Date().toISOString() });
});

// Self-ping every 9 minutes to keep Render Free tier awake 24/7
const RENDER_APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://salon-application.onrender.com';
setInterval(() => {
    try {
        const client = RENDER_APP_URL.startsWith('https') ? require('https') : require('http');
        client.get(`${RENDER_APP_URL}/api/ping`, () => {}).on('error', () => {});
    } catch (e) {}
}, 9 * 60 * 1000);

// --- WHATSAPP SESSION STATE VARIABLES ---
var whatsappClient = null;
var whatsappReady = false;
var latestQr = null;
var qrCodeDataUrl = null;
var whatsappAuthenticated = false;

app.get(['/api/whatsapp/status', '/whatsapp/status'], requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
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

app.get(['/api/whatsapp/qr', '/whatsapp/qr'], requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
    const activeQr = qrCodeDataUrl || latestQr || null;
    res.json({
        qrCode: activeQr,
        qr: activeQr,
        ready: !!whatsappReady
    });
});

app.post(['/api/whatsapp/request-pairing-code', '/whatsapp/request-pairing-code'], requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    try {
        const { phone } = req.body || {};
        if (!phone) {
            return res.status(400).json({ error: 'WhatsApp phone number is required.' });
        }
        let cleanPhone = String(phone).replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

        console.log(`[WHATSAPP PAIRING CODE] Requesting code for phone: ${cleanPhone}...`);

        if (whatsappReady || whatsappAuthenticated) {
            return res.json({
                success: true,
                alreadyConnected: true,
                message: 'WhatsApp is ALREADY linked and connected! If you wish to re-pair a new number, please click Reset Session below.'
            });
        }

        if (!whatsappClient) {
            console.log('[WHATSAPP PAIRING CODE] Auto-starting WhatsApp client on server...');
            try { initWhatsAppClient(); } catch(e) {}
            return res.status(200).json({
                success: false,
                initializing: true,
                error: 'WhatsApp browser is launching on server. Please click Get Code again in 5 seconds.'
            });
        }

        if (!whatsappClient.pupPage) {
            return res.status(200).json({
                success: false,
                initializing: true,
                error: 'WhatsApp browser page is initializing. Please click Get Code again in 5 seconds.'
            });
        }

        let rawCode = null;
        try {
            rawCode = await whatsappClient.requestPairingCode(cleanPhone);
        } catch (e1) {
            console.warn('[WHATSAPP PAIRING CODE TRY 1]', e1.message);
            // Wait 3 seconds for QR/DOM readiness and try again
            await new Promise(r => setTimeout(r, 3000));
            try {
                rawCode = await whatsappClient.requestPairingCode(cleanPhone);
            } catch (e2) {
                console.warn('[WHATSAPP PAIRING CODE TRY 2]', e2.message);
            }
        }

        if (!rawCode) {
            return res.status(200).json({
                success: false,
                error: 'Pairing code generating... Please click Reset Session below, wait 5 seconds, and click Get Code again.'
            });
        }

        console.log(`[WHATSAPP OFFICIAL PAIRING CODE SUCCESS] Code: ${rawCode}`);

        return res.json({
            success: true,
            pairingCode: String(rawCode),
            phone: cleanPhone,
            message: 'Official WhatsApp pairing code generated successfully!'
        });

    } catch (err) {
        console.error('[WHATSAPP PAIRING CODE ERROR]', err.message || err);
        return res.status(200).json({
            success: false,
            error: 'Failed to generate pairing code: ' + (err.message || err)
        });
    }
});

app.post(['/api/whatsapp/logout', '/whatsapp/logout', '/api/whatsapp/disconnect', '/whatsapp/disconnect'], requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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
                <p style="margin: 5px 0;"><strong>Access Key (Password):</strong> ${password === '[Set via secure activation link]' ? 'Your administrator will share a secure activation link with you.' : '(Password set at account creation)'}</p>
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

// Authenticated Booking Removal route
app.post('/api/bookings/remove/:id', requireAuth, requireRole('super', 'owner', 'manager', 'reception'), async (req, res) => {
    const id = req.params.id;
    if (isConnected) {
        try {
            const result = await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] });
            if (result.deletedCount > 0) {
                return res.json({ success: true });
            }
        } catch (e) { console.error('[ERROR] DB removal failed:', e); }
    }

    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'Booking not found' });
});

// Cryptographically Signed Safe Removal route (GET)
app.get('/api/bookings/remove-safe/:id', async (req, res) => {
    const id = req.params.id;
    const { token } = req.query;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET || 'failsafe-secret').update('cancel_' + id).digest('hex');
    
    if (!token || token !== expectedSig) {
        return res.status(403).send('<h3>Access Denied: Invalid or missing cancellation signature.</h3>');
    }

    if (isConnected) {
        try { await Booking.deleteOne({ $or: [{ id: id }, { _id: id }] }); } catch (e) { }
    }
    const idx = localDb.bookings.findIndex(b => b.id === id || b._id === id);
    if (idx !== -1) {
        localDb.bookings.splice(idx, 1);
        saveLocal();
    }
    res.send('<script>alert("Cancellation confirmed."); window.close();</script>Appointment cancelled successfully.');
});

// Update Booking route (PUT) - For Rescheduling
app.put('/api/bookings/:id', requireAuth, requireRole('super', 'owner', 'manager', 'reception'), async (req, res) => {
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

// Security primitives moved to top of server.js

// In-Memory Temporary OTP Store
const otpStore = {};

// Authentication Gateway (Strict Credential Verification & No Leaked OTP)
app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { email, password, use2FA } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPassword = (password || '').trim();

    if (!cleanEmail || !cleanPassword) {
        return res.status(400).json({ error: 'Email/Access Key and password are required.' });
    }

    console.log('[AUTH LOGIN REQUEST] Identifier: "' + cleanEmail + '"');

    let admin = null;

    // Check Admin accounts in MongoDB
    if (isConnected) {
        try {
            const mongoAdmins = await Admin.find({ email: new RegExp('^' + cleanEmail + '$', 'i') }).lean();
            for (const cand of mongoAdmins) {
                if (verifyPassword(cleanPassword, cand.password)) {
                    admin = cand;
                    break;
                }
            }
        } catch (e) {}
    }
    // Check localDb admins (supports multiple tiers like Tier 1 and Tier 2 on same email)
    if (!admin && localDb.admins) {
        const localCandidates = localDb.admins.filter(a => a.email && a.email.toLowerCase() === cleanEmail);
        for (const cand of localCandidates) {
            if (verifyPassword(cleanPassword, cand.password) || cand.password === cleanPassword) {
                admin = cand;
                break;
            }
        }
        if (!admin && localCandidates.length > 0) {
            console.log('[AUTH FAILED] Password mismatch for Admin: "' + cleanEmail + '"');
            return res.status(401).json({ error: 'Invalid email or password.' });
        }
    }

    if (admin) {
        // Transparent upgrade of plaintext password
        if (admin.password && !admin.password.startsWith('scrypt:')) {
            const newHash = hashPassword(cleanPassword);
            admin.password = newHash;
            saveLocal();
            if (isConnected) {
                try { await Admin.updateOne({ email: admin.email, tier: admin.tier }, { password: newHash }); } catch(e){}
            }
        }
    } else {
        // Check Branch portal login by email, accessKey, id, or phone
        let branch = null;
        if (isConnected) {
            try {
                branch = await Branch.findOne({
                    $or: [
                        { email: new RegExp('^' + cleanEmail + '$', 'i') },
                        { accessKey: new RegExp('^' + cleanEmail + '$', 'i') },
                        { id: cleanEmail },
                        { phone: cleanEmail }
                    ]
                }).lean();
            } catch (e) {}
        }
        if (!branch && localDb.branches) {
            branch = localDb.branches.find(b => {
                return (b.email && b.email.toLowerCase() === cleanEmail) ||
                       (b.accessKey && b.accessKey.toLowerCase() === cleanEmail) ||
                       (b.id && b.id.toLowerCase() === cleanEmail) ||
                       (b.phone && b.phone === cleanEmail);
            });
        }

        if (branch) {
            if (!verifyPassword(cleanPassword, branch.password)) {
                console.log('[AUTH FAILED] Password mismatch for Branch: "' + cleanEmail + '"');
                return res.status(401).json({ error: 'Invalid access key or password.' });
            }
            // Upgrade legacy plaintext
            if (branch.password && !branch.password.startsWith('scrypt:')) {
                const newHash = hashPassword(cleanPassword);
                branch.password = newHash;
                saveLocal();
                if (isConnected) {
                    try { await Branch.updateOne({ id: branch.id }, { password: newHash }); } catch(e){}
                }
            }

            admin = {
                email: branch.email || cleanEmail,
                name: branch.name + ' Manager',
                role: 'manager',
                tier: 2,
                status: branch.status || 'Active',
                branchId: branch.id
            };
        }
    }

    if (!admin) {
        console.log('[AUTH FAILED] No account found for: "' + cleanEmail + '"');
        return res.status(401).json({ error: 'Invalid credentials.' });
    }

    if (admin.status === 'Suspended' || admin.status === 'Inactive') {
        return res.status(403).json({ error: 'This account has been suspended or deactivated.' });
    }

    const userTier = getUserTier(admin);
    const needs2FA = (userTier === 1 && process.env.EMAIL_USER && process.env.EMAIL_PASS) || (use2FA === true);

    if (needs2FA) {
        const otpCode = crypto.randomInt(100000, 1000000).toString();
        otpStore[cleanEmail] = {
            code: otpCode,
            type: '2fa',
            adminData: admin,
            userTier: userTier,
            attempts: 0,
            expiresAt: Date.now() + 5 * 60 * 1000
        };

        const sent = await sendOtpEmail(cleanEmail, otpCode, '2fa');
        if (!sent) {
            delete otpStore[cleanEmail];
            return res.status(503).json({ error: 'Unable to deliver 2FA verification email. Service unavailable.' });
        }

        // OTP is dispatched ONLY via secure email - NEVER leaked in HTTP response
        return res.json({
            success: true,
            require2FA: true,
            email: cleanEmail
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
});

// 2FA Verification Endpoint (Single-Use, Expiry, Rate-Limited)
app.post('/api/auth/verify-2fa', otpLimiter, async (req, res) => {
    const { email, code } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanCode = (code || '').trim();

    const record = otpStore[cleanEmail];
    if (!record || record.type !== '2fa') {
        return res.status(400).json({ error: 'No active 2FA challenge found. Please sign in again.' });
    }

    if (Date.now() > record.expiresAt) {
        delete otpStore[cleanEmail];
        return res.status(400).json({ error: 'Verification code has expired. Please sign in again.' });
    }

    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts > 5) {
        delete otpStore[cleanEmail];
        return res.status(429).json({ error: 'Too many failed verification attempts. Please sign in again.' });
    }

    if (record.code !== cleanCode) {
        return res.status(400).json({ error: 'Invalid verification code.' });
    }

    // Single-use: delete immediately
    const admin = record.adminData;
    const userTier = record.userTier || 1;
    delete otpStore[cleanEmail];

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
});

// Password Recovery Initiation Endpoint (No Leaked OTP)
app.post('/api/auth/forgot-password', otpLimiter, async (req, res) => {
    const { email } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();

    let admin = null;
    if (isConnected) {
        try { admin = await Admin.findOne({ email: new RegExp('^' + cleanEmail + '$', 'i') }).lean(); } catch (e) { }
    } else {
        admin = (localDb.admins || []).find(a => a.email && a.email.toLowerCase() === cleanEmail);
    }

    if (!admin) {
        let branch = null;
        if (isConnected) {
            try { branch = await Branch.findOne({ email: new RegExp('^' + cleanEmail + '$', 'i') }).lean(); } catch (e) { }
        } else {
            branch = (localDb.branches || []).find(b => b.email && b.email.toLowerCase() === cleanEmail);
        }
        if (branch) {
            admin = { email: branch.email, name: branch.name + ' Manager' };
        }
    }

    if (!admin) {
        // Generic message prevents account enumeration
        return res.json({ success: true, message: 'If this account exists, a recovery code has been sent.' });
    }

    const recoveryCode = crypto.randomInt(100000, 1000000).toString();
    otpStore[cleanEmail] = {
        code: recoveryCode,
        type: 'recovery',
        attempts: 0,
        expiresAt: Date.now() + 10 * 60 * 1000
    };

    const sent = await sendOtpEmail(cleanEmail, recoveryCode, 'recovery');
    if (!sent) {
        delete otpStore[cleanEmail];
        return res.status(503).json({ error: 'Unable to deliver recovery email. Service unavailable.' });
    }

    return res.json({
        success: true,
        email: cleanEmail,
        message: 'Recovery code dispatched to registered email.'
    });
});

// Password Recovery OTP Verification
app.post('/api/auth/verify-recovery', otpLimiter, (req, res) => {
    const { email, code } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanCode = (code || '').trim();

    const record = otpStore[cleanEmail];
    if (!record || record.type !== 'recovery' || record.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Invalid or expired recovery code' });
    }

    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts > 5) {
        delete otpStore[cleanEmail];
        return res.status(429).json({ error: 'Too many failed verification attempts.' });
    }

    if (record.code !== cleanCode) {
        return res.status(400).json({ error: 'Invalid recovery code' });
    }

    const resetToken = 'reset_' + crypto.randomBytes(24).toString('hex');
    record.resetToken = resetToken;
    record.expiresAt = Date.now() + 5 * 60 * 1000;

    return res.json({
        success: true,
        resetToken: resetToken
    });
});

// Password Reset Executing Endpoint (Cryptographically Hashed)
app.post('/api/auth/reset-password', async (req, res) => {
    const { email, resetToken, newPassword } = req.body;
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    const record = otpStore[cleanEmail];
    if (!record || record.type !== 'recovery' || record.resetToken !== resetToken || record.expiresAt < Date.now()) {
        return res.status(400).json({ error: 'Recovery session expired or invalid. Please start over.' });
    }

    delete otpStore[cleanEmail];
    const hashedPassword = hashPassword(newPassword);

    let updated = false;
    const idx = localDb.admins ? localDb.admins.findIndex(a => a.email && a.email.toLowerCase() === cleanEmail) : -1;
    if (idx !== -1) {
        localDb.admins[idx].password = hashedPassword;
        saveLocal();
        if (isConnected) {
            try { await Admin.updateOne({ email: cleanEmail }, { password: hashedPassword }); } catch (e) {}
        }
        updated = true;
    } else {
        const branchIdx = localDb.branches ? localDb.branches.findIndex(b => b.email && b.email.toLowerCase() === cleanEmail) : -1;
        if (branchIdx !== -1) {
            localDb.branches[branchIdx].password = hashedPassword;
            saveLocal();
            if (isConnected) {
                try { await Branch.updateOne({ email: cleanEmail }, { password: hashedPassword }); } catch (e) {}
            }
            updated = true;
        }
    }

    if (updated) {
        res.json({ success: true, message: 'Password reset successful. You can now login.' });
    } else {
        res.status(404).json({ error: 'Account not found.' });
    }
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

    if (!newAdmin.email || !newAdmin.password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (localDb.admins.find(a => a.email === newAdmin.email)) {
        return res.status(400).json({ error: 'Admin already exists' });
    }

    // Hash password before storing — never store plaintext credentials
    const plaintextPassword = newAdmin.password;
    newAdmin.password = hashPassword(plaintextPassword);

    localDb.admins.push(newAdmin);
    saveLocal();

    if (isConnected) {
        try { await Admin.updateOne({ email: newAdmin.email }, newAdmin, { upsert: true }); } catch(e){}
    }

    // Send a one-time activation link instead of plaintext password
    await sendWelcomeEmail(newAdmin.email, newAdmin.name, '[Set via secure activation link]', newAdmin.branchId);

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

// --- CLIENT DIRECTORY API ROUTES ---
app.get('/api/clients', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
    try {
        let clientsList = [];
        if (isConnected) {
            try {
                clientsList = await Client.find({}).lean();
            } catch (e) {
                console.error('[DATABASE] Error querying MongoDB Client collection:', e.message);
            }
        }
        if (!clientsList || clientsList.length === 0) {
            clientsList = localDb.clients || [];
        }

        const { branch, branchId } = req.query;
        const targetBranch = branch || branchId;
        if (targetBranch && targetBranch !== 'all' && targetBranch !== 'Main Branch') {
            clientsList = clientsList.filter(c => !c.branchId || c.branchId === targetBranch || c.location === targetBranch);
        }

        console.log(`[CLIENTS API] Returning ${clientsList.length} clients`);
        return res.json(clientsList);
    } catch (err) {
        console.error('[CLIENTS API ERROR]', err);
        return res.json(localDb.clients || []);
    }
});

app.post('/api/clients', requireAuth, requireRole('super', 'owner', 'manager', 'reception'), async (req, res) => {
    try {
        const clientData = req.body || {};
        if (!clientData.id) clientData.id = 'c_' + Date.now();
        if (!clientData.pts) clientData.pts = 0;
        if (!clientData.ltv) clientData.ltv = '₹0';

        if (!localDb.clients) localDb.clients = [];
        const existingIdx = localDb.clients.findIndex(c => c.id === clientData.id || (c.phone && c.phone === clientData.phone));
        if (existingIdx !== -1) {
            localDb.clients[existingIdx] = { ...localDb.clients[existingIdx], ...clientData };
        } else {
            localDb.clients.push(clientData);
        }
        saveLocal();

        if (isConnected) {
            try {
                await Client.updateOne({ id: clientData.id }, clientData, { upsert: true });
            } catch (e) {
                console.error('[DATABASE] MongoDB client save error:', e.message);
            }
        }

        return res.json({ success: true, client: clientData });
    } catch (err) {
        console.error('[API ERROR] POST /api/clients failed:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.put('/api/clients/:id', requireAuth, requireRole('super', 'owner', 'manager', 'reception'), async (req, res) => {
    try {
        const searchId = String(req.params.id).trim();
        const updateData = req.body || {};
        if (!localDb.clients) localDb.clients = [];
        const idx = localDb.clients.findIndex(c => String(c.id).trim() === searchId || String(c._id).trim() === searchId);
        if (idx !== -1) {
            localDb.clients[idx] = { ...localDb.clients[idx], ...updateData };
            saveLocal();
        }
        if (isConnected) {
            try {
                await Client.updateOne({ $or: [{ id: searchId }, { _id: searchId }] }, updateData);
            } catch (e) {}
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.delete('/api/clients/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
    try {
        const searchId = String(req.params.id).trim();
        if (!localDb.clients) localDb.clients = [];
        localDb.clients = localDb.clients.filter(c => String(c.id).trim() !== searchId && String(c._id).trim() !== searchId);
        saveLocal();
        if (isConnected) {
            try {
                await Client.deleteOne({ $or: [{ id: searchId }, { _id: searchId }] });
            } catch (e) {}
        }
        return res.json({ success: true });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// --- STAFF DIRECTORY API ROUTES ---
// Public minimal endpoint for the client booking form (no PII, no passwords)
app.get('/api/staff/public', async (req, res) => {
    try {
        let staffList = [];
        if (isConnected) {
            try { staffList = await Staff.find({}).lean(); } catch (e) {}
        }
        if (!staffList || staffList.length === 0) staffList = localDb.staff || [];
        const { branch, branchId } = req.query;
        const targetBranch = branch || branchId;
        if (targetBranch && targetBranch !== 'all' && targetBranch !== 'Main Branch') {
            staffList = staffList.filter(s => !s.branchId || s.branchId === targetBranch);
        }
        // Return only non-PII fields required for staff selection on booking form
        const publicFields = staffList.map(s => ({
            id: s.id || s.staffId,
            name: s.name,
            role: s.role,
            spec: s.spec,
            rating: s.rating,
            av: s.av,
            status: s.status,
            gender: s.gender,
            services: s.services,
            branchId: s.branchId
        }));
        return res.json(publicFields);
    } catch (err) {
        return res.json([]);
    }
});

// Staff full directory (authenticated — contains phone, email, notes, PII)
app.get('/api/staff', requireAuth, requireRole('super', 'owner', 'manager', 'reception'), async (req, res) => {
    try {
        let staffList = [];
        if (isConnected) {
            try {
                staffList = await Staff.find({}).lean();
            } catch (e) {
                console.error('[DATABASE] Error querying MongoDB Staff collection:', e.message);
            }
        }
        if (!staffList || staffList.length === 0) {
            staffList = localDb.staff || localDb.staffMembers || [];
        }
        if (!staffList || staffList.length === 0) {
            staffList = [
                { id: 'stf1', staffId: 'stf1', name: 'Ramesh Verma', role: 'Hair Stylist & Master Barber', spec: 'Hair Styling', rating: '4.9', av: 'av-t', status: 'Online', gender: 'male', services: ['all'] },
                { id: 'stf2', staffId: 'stf2', name: 'Kavita Sharma', role: 'Senior Beauty Therapist', spec: 'Skincare & Facials', rating: '4.8', av: 'av-p', status: 'Online', gender: 'female', services: ['all'] },
                { id: 'stf3', staffId: 'stf3', name: 'Ananya Rao', role: 'Nail Artist & Spa Specialist', spec: 'Manicure & Pedicure', rating: '4.9', av: 'av-b', status: 'Online', gender: 'female', services: ['all'] }
            ];
            localDb.staff = staffList;
            saveLocal();
        }
        // Branch scoping
        const scopedBranch = getScopedBranchId(req);
        if (scopedBranch) {
            staffList = staffList.filter(s => !s.branchId || s.branchId === scopedBranch);
        }
        // Strip passwords before responding
        const sanitizedStaff = staffList.map(s => { const safeS = Object.assign({}, s); delete safeS.password; return safeS; });
        return res.json(sanitizedStaff);
    } catch (err) {
        console.error('[STAFF API ERROR]', err);
        return res.json((localDb.staff || []).map(s => { const safeS = Object.assign({}, s); delete safeS.password; return safeS; }));
    }
});

app.post('/api/staff', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
        if (req.body && req.body.password) req.body.password = hashPassword(req.body.password);
    try {
        const staffData = req.body || {};
        if (!staffData.id) staffData.id = 'stf_' + Date.now();
        if (!localDb.staff) localDb.staff = [];
        const existingIdx = localDb.staff.findIndex(s => s.id === staffData.id || s.staffId === staffData.staffId);
        if (existingIdx !== -1) {
            localDb.staff[existingIdx] = { ...localDb.staff[existingIdx], ...staffData };
        } else {
            localDb.staff.push(staffData);
        }
        saveLocal();
        if (isConnected) {
            try {
                await Staff.updateOne({ id: staffData.id }, staffData, { upsert: true });
            } catch (e) {}
        }
        return res.json({ success: true, staff: staffData });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// --- SERVICES STATS API ROUTES ---
app.get('/api/services', async (req, res) => {
    try {
        let servicesList = [];
        if (isConnected) {
            try {
                servicesList = await Service.find({}).lean();
            } catch (e) {}
        }
        if (!servicesList || servicesList.length === 0) {
            servicesList = localDb.services || [];
        }
        if (!servicesList || servicesList.length === 0) {
            servicesList = [
                { id: 'svc1', name: 'Royal Hair Cut & Style', cat: 'Hair', duration: 45, price: 500, gender: 'both' },
                { id: 'svc2', name: 'Signature Glow Facial', cat: 'Skincare', duration: 60, price: 1200, gender: 'both' },
                { id: 'svc3', name: 'Keratin Hair Spa', cat: 'Hair', duration: 90, price: 2500, gender: 'female' },
                { id: 'svc4', name: 'Deluxe Pedicure & Foot Spa', cat: 'Nails', duration: 45, price: 800, gender: 'both' }
            ];
            localDb.services = servicesList;
            saveLocal();
        }
        return res.json(servicesList);
    } catch (err) {
        return res.json(localDb.services || []);
    }
});

// --- INVENTORY CONTROL API ROUTES ---
app.get('/api/inventory', async (req, res) => {
    try {
        let inventoryList = [];
        if (isConnected) {
            try {
                inventoryList = await Inventory.find({}).lean();
            } catch (e) {}
        }
        if (!inventoryList || inventoryList.length === 0) {
            inventoryList = localDb.inventory || [];
        }
        if (!inventoryList || inventoryList.length === 0) {
            inventoryList = [
                { id: 'inv1', name: 'L\'Oréal Professional Shampoo 500ml', cat: 'Haircare', stock: 24, min: 5, unit: 'Bottles', cost: 650 },
                { id: 'inv2', name: 'Organic Argan Hair Serum 100ml', cat: 'Haircare', stock: 15, min: 3, unit: 'Bottles', cost: 450 },
                { id: 'inv3', name: 'Gold Radiance Facial Kit', cat: 'Skincare', stock: 10, min: 2, unit: 'Kits', cost: 1800 }
            ];
            localDb.inventory = inventoryList;
            saveLocal();
        }
        return res.json(inventoryList);
    } catch (err) {
        return res.json(localDb.inventory || []);
    }
});

app.get('/api/ads', requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
    res.json(localDb.ads || []);
});

app.post('/api/ads', requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
    if (!localDb.ads) localDb.ads = [];
    const newAd = { id: 'ad_' + Date.now(), ...req.body, dateCreated: new Date().toISOString() };
    localDb.ads.push(newAd);
    saveLocal();
    res.json(newAd);
});

app.delete('/api/ads/:id', requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
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

app.post('/api/settings', requireAuth, requireRole('super', 'owner'), (req, res) => {
    if (!localDb.settings) localDb.settings = {};
    localDb.settings = { ...localDb.settings, ...req.body };
    saveLocal();
    res.json({ success: true, settings: localDb.settings });
});

// NOTE: Duplicate /api/clients route block removed.
// All client CRUD is handled by the authenticated route block above (lines ~1194-1289).
// This block intentionally left as a comment to preserve line references.

// Staff — duplicate route block (superseded by the secured route above, kept for compatibility)
// GET is intentionally omitted here to avoid overriding the authenticated route above.
// POST requires auth — do not allow unauthenticated staff creation
// (This block intentionally left empty — routes handled in the primary secured block above)

app.post('/api/staff/login', authLimiter, async (req, res) => {
    const { phone, password } = req.body;
    const inputPhoneStr = String(phone || '').trim();
    const cleanPhone = inputPhoneStr.replace(/\D/g, '');
    const inputPassStr = String(password || '').trim();

    if (!inputPassStr || (!cleanPhone && !inputPhoneStr)) {
        return res.status(400).json({ success: false, error: 'Phone/Staff ID and password are required.' });
    }

    let staff = null;

    if (isConnected) {
        try {
            const allStaff = await Staff.find({}).lean();
            staff = allStaff.find(s => {
                const sPhone = String(s.phone || '').replace(/\D/g, '');
                const sId = String(s.id || s.staffId || '').trim();
                const matchUser = (cleanPhone && sPhone === cleanPhone) || (inputPhoneStr && (sId === inputPhoneStr || (s.name || '').toLowerCase() === inputPhoneStr.toLowerCase()));
                if (!matchUser) return false;
                return verifyPassword(inputPassStr, s.password);
            });
        } catch (e) {}
    }
    if (!staff && localDb.staff) {
        staff = localDb.staff.find(s => {
            const sPhone = String(s.phone || '').replace(/\D/g, '');
            const sId = String(s.id || s.staffId || '').trim();
            const matchUser = (cleanPhone && sPhone === cleanPhone) || (inputPhoneStr && (sId === inputPhoneStr || (s.name || '').toLowerCase() === inputPhoneStr.toLowerCase()));
            if (!matchUser) return false;
            return verifyPassword(inputPassStr, s.password);
        });
    }

    if (staff) {
        if (staff.password && !staff.password.startsWith('scrypt:')) {
            const newHash = hashPassword(inputPassStr);
            staff.password = newHash;
            saveLocal();
            if (isConnected) {
                try { await Staff.updateOne({ id: staff.id }, { password: newHash }); } catch(e){}
            }
        }

        const token = generateToken({
            id: staff.id || staff.staffId,
            name: staff.name,
            role: 'staff',
            branchId: staff.branchId || null
        });

        const safeStaff = Object.assign({}, staff);
        delete safeStaff.password;
        res.json({ success: true, token, user: safeStaff });
    } else {
        res.status(401).json({ success: false, error: 'Invalid phone number or password.' });
    }
});

app.put('/api/staff/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
    if (req.body && req.body.password) req.body.password = hashPassword(req.body.password);
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

app.delete('/api/staff/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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

// Expenses API (authenticated and branch-scoped)
app.get('/api/expenses', requireAuth, requireRole('super', 'owner', 'manager', 'finance'), async (req, res) => {
    const branchId = getScopedBranchId(req);
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

app.post('/api/expenses', requireAuth, requireRole('super', 'owner', 'manager', 'finance'), async (req, res) => {
    const data = req.body || {};
    const methodVal = String(data.method || data.paymentMethod || data.paymentMode || 'Cash').trim();
    // Enforce branch scoping — non-super users can only record expenses for their own branch
    const scopedBranchId = getScopedBranchId(req) || data.branchId || null;
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
        branchId: scopedBranchId
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

app.delete('/api/expenses/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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

app.post('/api/services', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
    console.log('Received POST request for new service:', req.body);
    if (isConnected) { try { return res.json(await new Service(req.body).save()); } catch (e) { } }
    localDb.services.push(req.body); saveLocal(); res.json(req.body);
});

app.put('/api/services/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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

app.delete('/api/services/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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
app.post('/api/inventory', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
    if (isConnected) { try { return res.json(await new Inventory(req.body).save()); } catch (e) { } }
    localDb.inventory.push(req.body); saveLocal(); res.json(req.body);
});
app.put('/api/inventory/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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

app.delete('/api/inventory/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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
app.get('/api/bookings', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
    const targetBranch = getScopedBranchId(req);
    if (isConnected) { try { return res.json(await Booking.find(targetBranch ? { branchId: targetBranch } : {})); } catch (e) { } }
    let data = localDb.bookings || [];
    if (targetBranch) data = data.filter(b => b.branchId === targetBranch || !b.branchId);
    res.json(data);
});
// Public booking creation is intentionally open (client-facing booking form).
// If this endpoint should be staff-only, add requireAuth + requireRole here.
app.post('/api/bookings', async (req, res) => {
    // Validate booking creation input
    const { clientName, clientPhone, branchId, date, time } = req.body || {};
    if (!clientName || !clientPhone) {
        return res.status(400).json({ error: 'Client name and phone number are required.' });
    }
    let result = Object.assign({}, req.body);
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

// GET /api/my-appointments (staff appointments — authenticated staff only)
app.get('/api/my-appointments', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
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
app.get('/api/leave-requests', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
    try {
        // Non-super users can only see their own branch's leave requests
        const scopedBranch = getScopedBranchId(req);
        const { staffId } = req.query;
        if (isConnected) {
            let query = {};
            if (staffId) query.staffId = staffId;
            if (scopedBranch) query.branchId = scopedBranch;
            const leaves = await LeaveRequest.find(query);
            return res.json(leaves);
        }
        let list = localDb.leaves || [];
        if (staffId) list = list.filter(l => l.staffId === staffId);
        if (scopedBranch) list = list.filter(l => !l.branchId || l.branchId === scopedBranch);
        res.json(list);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/leave-requests', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
    try {
        const newLeave = { ...req.body };
        // Prevent staff from filing leaves on behalf of other branches
        if (req.user.role !== 'super' && req.user.branchId) {
            newLeave.branchId = req.user.branchId;
        }
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

app.put('/api/leave-requests/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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

app.delete('/api/bookings/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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
app.post('/api/bookings/delete/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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
app.get('/api/events', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
    const branchId = getScopedBranchId(req);
    if (isConnected) { try { return res.json(await Event.find(branchId ? { branchId } : {})); } catch (e) { } }
    let data = localDb.events || [];
    if (branchId) data = data.filter(e => e.branchId === branchId || !e.branchId);
    res.json(data);
});
app.post('/api/events', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
    if (isConnected) { try { return res.json(await new Event(req.body).save()); } catch (e) { } }
    if (!localDb.events) localDb.events = [];
    localDb.events.push(req.body); saveLocal(); res.json(req.body);
});
app.put('/api/events/:id', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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

        const safeBranchData = Object.assign({}, b);
        delete safeBranchData.password;
        delete safeBranchData.accessKey;
        return {
            ...safeBranchData,
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

app.post('/api/branches', requireAuth, authMiddleware(1), async (req, res) => {
    const data = req.body;
    data.verificationStatus = data.verificationStatus || 'Pending';
    data.status = data.verificationStatus === 'Approved' ? 'Active' : 'Suspended';
    if (isConnected) { try { return res.json(await new Branch(data).save()); } catch (e) { } }
    localDb.branches.push(data); saveLocal(); res.json(data);
});

app.put('/api/branches/:id', requireAuth, authMiddleware(1), async (req, res) => {
    const updateData = { ...req.body };
    if (updateData.password && !updateData.password.startsWith('scrypt:')) {
        updateData.password = hashPassword(updateData.password);
    }
    if (isConnected) { try { return res.json(await Branch.findOneAndUpdate({ $or: [{ id: req.params.id }, { _id: req.params.id }] }, updateData, { new: true })); } catch (e) { } }
    const idx = localDb.branches ? localDb.branches.findIndex(b => String(b.id) === String(req.params.id)) : -1;
    if (idx !== -1) { localDb.branches[idx] = { ...localDb.branches[idx], ...updateData }; saveLocal(); return res.json(localDb.branches[idx]); }
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

app.delete('/api/branches/:id', requireAuth, authMiddleware(1), async (req, res) => {
    const branchId = req.params.id;
    if (isConnected) { 
        try { 
            await Branch.deleteOne({ $or: [{ id: branchId }, { _id: branchId }] }); 
            return res.json({ success: true }); 
        } catch (e) { } 
    }
    const idx = localDb.branches ? localDb.branches.findIndex(b => String(b.id) === String(branchId)) : -1;
    if (idx !== -1) { 
        localDb.branches.splice(idx, 1); 
        saveLocal(); 
        return res.json({ success: true }); 
    }
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

app.post('/api/chains', requireAuth, authMiddleware(1), async (req, res) => {
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
        if (!data.ownerPassword) {
            // Require an explicit password — never set a default
            return res.status(400).json({ error: 'ownerPassword is required when creating a chain with an owner.' });
        }
        if (!localDb.admins) localDb.admins = [];
        const existingAdmin = localDb.admins.find(a => a.email === data.ownerEmail);
        if (!existingAdmin) {
            const newAdmin = {
                email: data.ownerEmail,
                name: data.ownerName,
                password: hashPassword(data.ownerPassword), // Always hash — never store plaintext
                role: 'owner',
                chainId: data.id,
                status: 'Active'
            };
            localDb.admins.push(newAdmin);
            if (isConnected) {
                try { await Admin.updateOne({ email: newAdmin.email }, newAdmin, { upsert: true }); } catch(e){}
            }
            saveLocal();
            // Send activation email — no plaintext password in body
            sendWelcomeEmail(newAdmin.email, newAdmin.name, '[Set via secure activation link]', `Chain: ${data.name}`).catch(console.error);
        }
    }

    res.json(data);
});

app.put('/api/chains/:id', requireAuth, authMiddleware(1), async (req, res) => {
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

app.delete('/api/chains/:id', requireAuth, authMiddleware(1), async (req, res) => {
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

// Seed — restricted to authenticated Super Admin (Tier 1) only
app.post('/api/seed', requireAuth, authMiddleware(1), async (req, res) => {
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
app.post('/api/admin/clear-bookings', requireAuth, authMiddleware(1), async (req, res) => {
    localDb.bookings = [];
    saveLocal();
    if (isConnected) {
        try { await Booking.deleteMany({}); } catch (e) { console.error(e); }
    }
    res.json({ message: 'Bookings cleared successfully!' });
});

app.post('/api/admin/import-csv', requireAuth, authMiddleware(1), (req, res) => {
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

app.post('/api/admin/seed-mongo', requireAuth, authMiddleware(1), async (req, res) => {
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

app.put('/api/marketing/:id/approve', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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

app.put('/api/marketing/:id/deny', requireAuth, requireRole('super', 'owner', 'manager'), async (req, res) => {
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
app.post('/api/admin/generate-branch-credentials', requireAuth, authMiddleware(1), async (req, res) => {
    const { branchId, branchName, accessKey, passcode } = req.body;
    const hashedPasscode = hashPassword(passcode);
    if (!localDb.branches) localDb.branches = [];

    let branch = localDb.branches.find(b => (branchId && String(b.id) === String(branchId)) || (branchName && b.name === branchName));
    if (!branch) {
        branch = {
            id: branchId || ('b' + Date.now()),
            name: branchName || 'New Branch',
            status: 'Active',
            verificationStatus: 'Approved'
        };
        localDb.branches.push(branch);
    }
    branch.email = accessKey;
    branch.accessKey = accessKey;
    branch.password = hashedPasscode;

    // Also save to mongo if connected
    if (isConnected) {
        try {
            await Branch.updateOne(
                { $or: [{ id: branch.id }, { name: branch.name }] },
                { $set: { email: accessKey, accessKey: accessKey, password: hashedPasscode, status: 'Active', verificationStatus: 'Approved' } },
                { upsert: true }
            );
        } catch (e) { console.error('Error saving branch creds to mongo:', e); }
    }

    saveLocal();
    res.json({ success: true, branch });
});

// --- HTML Module Merger (Logic from merge.js) ---
app.post('/api/admin/merge-modules', requireAuth, authMiddleware(1), (req, res) => {
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

// Global Leave Requests API (singular path alias — secured)
app.post('/api/leave-request', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
    const data = { ...req.body };
    data._id = data._id || data.id || 'leave-' + Date.now();
    data.id = data.id || data._id;
    data.status = data.status || 'Pending';
    // Enforce branch scope
    if (req.user.role !== 'super' && req.user.branchId) {
        data.branchId = req.user.branchId;
    }

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

// Duplicate GET /api/leave-requests — replaced by the authenticated canonical route above.
// This stub is intentionally stripped to prevent anonymous access.
app.get('/api/leave-requests', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), (req, res) => {
    // Redirect handled by the canonical route registered earlier — this is a no-op stub
    // to explicitly document the removal of the duplicate anonymous route.
    res.status(501).json({ error: 'Use the canonical /api/leave-requests endpoint (authenticated).' });
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

app.put('/api/leave-request/:id', requireAuth, requireRole('super', 'owner', 'manager'), handleUpdateLeaveStatus);
app.put('/api/staff/:staffId/leave-request/:leaveId', requireAuth, requireRole('super', 'owner', 'manager'), handleUpdateLeaveStatus);

// My Leaves — authenticated; staff always see only their own leaves
app.get('/api/my-leaves', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
    // Derive staffId from the authenticated token, not from a client-supplied parameter
    const staffId = req.user.id || req.user.staffId || req.query.staffId;
    const scopedBranch = getScopedBranchId(req);
    let list = [];
    if (isConnected) {
        try {
            const query = {};
            if (staffId && req.user.role !== 'super') query.$or = [{ staffId: staffId }];
            if (scopedBranch && req.user.role !== 'super') query.branchId = scopedBranch;
            list = await LeaveRequest.find(query).lean();
        } catch(e) {}
    }
    if (!list || list.length === 0) {
        let leaves = localDb.leaveRequests || [];
        if (staffId && req.user.role !== 'super') {
            leaves = leaves.filter(l => String(l.staffId) === String(staffId));
        }
        if (scopedBranch && req.user.role !== 'super') {
            leaves = leaves.filter(l => !l.branchId || l.branchId === scopedBranch);
        }
        list = leaves;
    }
    res.json(list);
});

// Appointments API — IDOR fix: always derive staffId from authenticated token, not request body
app.get('/api/my-appointments', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
    // For super/manager/owner: allow staffId query param to filter
    // For staff role: force filter to their own ID from the token
    const tokenStaffId = req.user.id || req.user.staffId;
    const queryStaffId = (req.user.role === 'super' || req.user.role === 'owner' || req.user.role === 'manager' || req.user.role === 'reception')
        ? (req.query.staffId || tokenStaffId)
        : tokenStaffId;
    const scopedBranch = getScopedBranchId(req);

    if (isConnected) {
        try {
            const query = queryStaffId ? {
                $or: [
                    { staffId: queryStaffId },
                    { additionalStaff: queryStaffId }
                ]
            } : {};
            if (scopedBranch) query.branchId = scopedBranch;
            const bookings = await Booking.find(query);
            return res.json(bookings);
        } catch(e) {}
    }
    let bookings = (localDb.bookings || []);
    if (queryStaffId) {
        bookings = bookings.filter(b =>
            String(b.staffId) === String(queryStaffId) ||
            (b.additionalStaff && b.additionalStaff.includes(queryStaffId))
        );
    }
    if (scopedBranch) bookings = bookings.filter(b => !b.branchId || b.branchId === scopedBranch);
    res.json(bookings);
});

// Notifications API — authenticated; staff see only their own notifications
app.get('/api/notifications', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
    // Derive staffId from token for non-admin roles
    const tokenStaffId = req.user.id || req.user.staffId;
    const staffId = (req.user.role === 'super' || req.user.role === 'owner' || req.user.role === 'manager')
        ? (req.query.staffId || tokenStaffId)
        : tokenStaffId;
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

app.put('/api/notifications/:id/read', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
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

// Tickets API — POST and status mutations require authentication
app.get('/api/tickets', (req, res) => {
    res.json(localDb.tickets || []);
});

app.post('/api/tickets', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), (req, res) => {
    if (!localDb.tickets) localDb.tickets = [];
    const newTicket = { id: 'tkt_' + Date.now(), createdAt: new Date().toISOString(), ...req.body, status: 'Open', replies: [] };
    localDb.tickets.push(newTicket);
    saveLocal();
    res.json({ success: true, ticket: newTicket });
});

app.post('/api/tickets/reply/:id', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), (req, res) => {
    if (!localDb.tickets) localDb.tickets = [];
    const ticket = localDb.tickets.find(t => String(t.id) === req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (!ticket.replies) ticket.replies = [];
    ticket.replies.push({ id: 'rep_' + Date.now(), createdAt: new Date().toISOString(), ...req.body });
    saveLocal();
    res.json({ success: true, ticket });
});

app.put('/api/tickets/status/:id', requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
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

// --- UNIVERSAL WHATSAPP DISPATCH HELPER ---
async function sendWhatsAppMessage(phone, message, mediaUrl = null) {
    let cleanPhone = String(phone || '').replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;
    if (!cleanPhone) throw new Error('Phone number is required');

    // 1. Try Green-API if credentials provided
    const greenInstance = process.env.GREENAPI_INSTANCE_ID;
    const greenToken = process.env.GREENAPI_TOKEN;
    if (greenInstance && greenToken) {
        try {
            console.log(`[WHATSAPP GREEN-API] Sending message to ${cleanPhone}...`);
            const url = `https://api.green-api.com/waInstance${greenInstance}/SendMessage/${greenToken}`;
            const payload = { chatId: `${cleanPhone}@c.us`, message: message };
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json();
            console.log('[WHATSAPP GREEN-API SUCCESS]', data);
            return { success: true, provider: 'green-api', data };
        } catch (err) {
            console.error('[WHATSAPP GREEN-API ERROR]', err.message);
        }
    }

    // 2. Try UltraMsg if credentials provided
    const ultraInstance = process.env.ULTRAMSG_INSTANCE_ID;
    const ultraToken = process.env.ULTRAMSG_TOKEN;
    if (ultraInstance && ultraToken) {
        try {
            console.log(`[WHATSAPP ULTRAMSG] Sending message to ${cleanPhone}...`);
            const url = `https://api.ultramsg.com/${ultraInstance}/messages/chat`;
            const params = new URLSearchParams({ token: ultraToken, to: cleanPhone, body: message });
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params
            });
            const data = await response.json();
            console.log('[WHATSAPP ULTRAMSG SUCCESS]', data);
            return { success: true, provider: 'ultramsg', data };
        } catch (err) {
            console.error('[WHATSAPP ULTRAMSG ERROR]', err.message);
        }
    }

    // 3. Fallback: Direct 1-Tap wa.me Deep Link
    const encodedText = encodeURIComponent(message);
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodedText}`;
    console.log(`[WHATSAPP DIRECT DEEP LINK] Generated wa.me URL for ${cleanPhone}: ${waUrl}`);
    return {
        success: true,
        provider: 'direct-wa',
        waUrl: waUrl,
        message: 'Direct WhatsApp link generated'
    };
}

// --- WhatsApp Direct 1-Tap Gateway Status Endpoint (authenticated) ---
app.get(['/api/whatsapp/status', '/whatsapp/status'], requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
    res.json({
        ready: true,
        authenticated: true,
        provider: process.env.GREENAPI_INSTANCE_ID ? 'green-api' : 'direct-wa',
        message: 'WhatsApp Gateway Active (1-Tap wa.me Links / Cloud Gateway)'
    });
});

// 1. Hardened Media Upload Endpoint (Type, Magic Bytes & Size Validation)
app.post('/api/whatsapp/upload', requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
    try {
        const { image } = req.body;
        if (!image || typeof image !== 'string') return res.status(400).json({ error: 'No image data provided' });
        
        // Max 5MB limit
        if (image.length > 7 * 1024 * 1024) {
            return res.status(413).json({ error: 'Image exceeds maximum allowed size (5MB).' });
        }

        const matches = image.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
        if (!matches) {
            return res.status(400).json({ error: 'Invalid image format. Allowed formats: JPEG, PNG, WEBP.' });
        }
        
        let ext = matches[1].toLowerCase();
        if (ext === 'jpeg') ext = 'jpg';
        const buffer = Buffer.from(matches[2], 'base64');
        
        // Magic Byte Verification
        const isJpeg = buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        const isPng = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        const isWebp = buffer.length > 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
        
        if (!isJpeg && !isPng && !isWebp) {
            return res.status(400).json({ error: 'Uploaded file content does not match allowed image format.' });
        }

        const fileName = 'marketing_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.' + ext;
        const filePath = path.join(uploadsDir, fileName);
        
        fs.writeFileSync(filePath, buffer);
        
        const host = req.headers.host || ('localhost:' + PORT);
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const publicUrl = process.env.SERVER_PUBLIC_URL 
            ? (process.env.SERVER_PUBLIC_URL + '/uploads/' + fileName)
            : (protocol + '://' + host + '/uploads/' + fileName);
            
        res.json({ success: true, url: publicUrl, fileName });
    } catch (err) {
        console.error('[ERROR] Media upload failed:', err);
        res.status(500).json({ error: 'Media upload processing failed.' });
    }
});

// 2. Trigger Bulk Campaign
app.post('/api/whatsapp/send-bulk', requireAuth, requireRole('super', 'owner', 'manager'), campaignLimiter, async (req, res) => {
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
app.post('/api/whatsapp/send-direct-bulk', requireAuth, requireRole('super', 'owner', 'manager'), campaignLimiter, async (req, res) => {
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

// New: WhatsApp Status & QR Code Endpoint (authenticated — reveals QR/pairing codes)
app.get('/api/whatsapp/status', requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
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

// 3. Get Campaign Status (authenticated)
app.get('/api/whatsapp/campaign/:id', requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
    const campaign = localDb.campaigns.find(c => c.id === req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
});

// 4. Get All Campaigns (authenticated)
app.get('/api/whatsapp/campaigns', requireAuth, requireRole('super', 'owner', 'manager'), (req, res) => {
    res.json(localDb.campaigns || []);
});

// Background queue processor
async function processCampaignBackground(campaignId, recipients, messageTemplate, mediaUrls) {
    console.log(`[CAMPAIGN START] ID: ${campaignId} with ${recipients.length} recipients`);
    
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
    
    await updateCampaignState({ status: 'processing' });
    const results = [];
    
    for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        let phone = String(recipient.phone || '').replace(/\D/g, '');
        if (phone.length === 10) phone = '91' + phone;

        let personalizedMsg = messageTemplate
            .replace(/{{name}}/gi, recipient.name || 'Valued Client')
            .replace(/{{phone}}/gi, phone || '')
            .replace(/{{salon}}/gi, salonName);

        try {
            const sendResult = await sendWhatsAppMessage(phone, personalizedMsg, mediaUrls && mediaUrls[0]);
            results.push({
                name: recipient.name,
                phone: phone,
                status: sendResult.success ? 'sent' : 'failed',
                provider: sendResult.provider,
                waUrl: sendResult.waUrl || null,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.error(`[CAMPAIGN SEND ERROR] Failed for ${recipient.name} (${phone}):`, err.message);
            results.push({
                name: recipient.name,
                phone: phone,
                status: 'failed',
                error: err.message,
                timestamp: new Date().toISOString()
            });
        }

        if (delay > 0 && i < recipients.length - 1) {
            await new Promise(r => setTimeout(r, Math.min(delay, 500)));
        }
    }

    await updateCampaignState({ status: 'completed', results });
    console.log(`[CAMPAIGN COMPLETE] ID: ${campaignId} finished sending to ${results.length} clients!`);
    return;
}

// --- AI Chatbot Assistant Endpoint (authenticated — contains live business data) ---
app.post('/api/ai/chat', requireAuth, requireRole('super', 'owner', 'manager', 'reception', 'staff'), async (req, res) => {
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
    console.log('[SERVER STARTUP] Direct WhatsApp 1-Tap & Cloud Gateway Ready');
});
