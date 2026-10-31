const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

// Import or recreate auth helpers to test cryptographic verification
const JWT_SECRET = process.env.JWT_SECRET || '3ac08d0cccd1040aac739c4d30998672a1ef78ab22651c10d775a843b2e4be8a';

function generateToken(payload, expiresInSeconds = 3600) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const enrichedPayload = Object.assign({}, payload, {
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + expiresInSeconds
    });
    const body = Buffer.from(JSON.stringify(enrichedPayload)).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
    return header + '.' + body + '.' + signature;
}

function verifyToken(token) {
    try {
        if (!token) return null;
        if (token.startsWith('Bearer ')) token = token.substring(7).trim();
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const header = parts[0];
        const body = parts[1];
        const signature = parts[2];
        const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            return null;
        }
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload.exp && Date.now() >= payload.exp * 1000) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

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
    return false;
}

describe('Authentication & Cryptographic Security Test Suite', () => {
    it('should generate valid JWT tokens with signature', () => {
        const payload = { id: 'admin1', role: 'owner', branchId: 'b1' };
        const token = generateToken(payload);
        assert.ok(token);
        assert.strictEqual(token.split('.').length, 3);
    });

    it('should successfully decode and verify a valid JWT token', () => {
        const payload = { id: 'admin2', role: 'super', branchId: 'all' };
        const token = generateToken(payload);
        const decoded = verifyToken(token);
        assert.ok(decoded);
        assert.strictEqual(decoded.id, 'admin2');
        assert.strictEqual(decoded.role, 'super');
    });

    it('should reject tampered or forged JWT tokens', () => {
        const payload = { id: 'admin3', role: 'staff', branchId: 'b1' };
        const token = generateToken(payload);
        const parts = token.split('.');
        // Tamper with payload
        const tamperedBody = Buffer.from(JSON.stringify({ id: 'admin3', role: 'super' })).toString('base64url');
        const forgedToken = parts[0] + '.' + tamperedBody + '.' + parts[2];
        const result = verifyToken(forgedToken);
        assert.strictEqual(result, null);
    });

    it('should reject expired JWT tokens', () => {
        const payload = { id: 'admin4', role: 'reception' };
        // Expired 10 seconds ago
        const token = generateToken(payload, -10);
        const result = verifyToken(token);
        assert.strictEqual(result, null);
    });

    it('should securely hash passwords with scrypt and unique salts', () => {
        const raw = 'SalonSecure@2026';
        const hash1 = hashPassword(raw);
        const hash2 = hashPassword(raw);
        assert.ok(hash1.startsWith('scrypt:'));
        assert.ok(hash2.startsWith('scrypt:'));
        // Salt ensures two hashes of the same password are distinct
        assert.notStrictEqual(hash1, hash2);
        assert.ok(verifyPassword(raw, hash1));
        assert.ok(verifyPassword(raw, hash2));
        assert.strictEqual(verifyPassword('WrongPass', hash1), false);
    });
});

