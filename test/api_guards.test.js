const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('API Security Guards & Business Logic Test Suite', () => {
    it('requireAuth should reject requests missing authorization token', () => {
        let statusCode = null;
        let responseJson = null;

        const req = { cookies: {}, headers: {}, query: {} };
        const res = {
            status: (code) => {
                statusCode = code;
                return {
                    json: (data) => { responseJson = data; }
                };
            }
        };
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        // Middleware simulation
        const requireAuth = (req, res, next) => {
            const token = req.cookies?.authToken || req.headers['authorization'];
            if (!token) {
                return res.status(401).json({ error: 'Access denied: Authentication required.' });
            }
            next();
        };

        requireAuth(req, res, next);
        assert.strictEqual(statusCode, 401);
        assert.strictEqual(nextCalled, false);
        assert.ok(responseJson.error.includes('Authentication required'));
    });

    it('requireRole should prevent non-permitted roles from accessing restricted endpoints', () => {
        let statusCode = null;
        let responseJson = null;

        const req = { user: { role: 'staff', name: 'John Doe' } };
        const res = {
            status: (code) => {
                statusCode = code;
                return {
                    json: (data) => { responseJson = data; }
                };
            }
        };
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        const requireRole = (...allowed) => (req, res, next) => {
            if (req.user.role === 'super') return next();
            if (!allowed.includes(req.user.role)) {
                return res.status(403).json({ error: 'Access denied' });
            }
            next();
        };

        const guard = requireRole('super', 'owner', 'manager');
        guard(req, res, next);

        assert.strictEqual(statusCode, 403);
        assert.strictEqual(nextCalled, false);
    });

    it('should detect double-booking slot collision for the same specialist', () => {
        const existingBookings = [
            { id: 'b1', staffId: 'st_101', date: '2026-11-05', time: '14:00', status: 'Confirmed' },
            { id: 'b2', staffId: 'st_102', date: '2026-11-05', time: '14:00', status: 'Confirmed' }
        ];

        function checkSlotConflict(newBooking) {
            if (!newBooking.staffId || newBooking.staffId === 'any') return false;
            return existingBookings.some(b => 
                b.staffId === newBooking.staffId && 
                b.date === newBooking.date && 
                b.time === newBooking.time && 
                b.status !== 'Cancelled'
            );
        }

        // Conflict check: attempting to book st_101 at same date and time
        const conflictingBooking = { staffId: 'st_101', date: '2026-11-05', time: '14:00' };
        assert.strictEqual(checkSlotConflict(conflictingBooking), true);

        // No conflict: different time
        const validBooking1 = { staffId: 'st_101', date: '2026-11-05', time: '15:00' };
        assert.strictEqual(checkSlotConflict(validBooking1), false);

        // No conflict: different specialist
        const validBooking2 = { staffId: 'st_103', date: '2026-11-05', time: '14:00' };
        assert.strictEqual(checkSlotConflict(validBooking2), false);
    });

    it('NoSQL sanitizer should remove MongoDB query operator keys', () => {
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

        const maliciousPayload = {
            username: 'admin',
            password: { '$gt': '' },
            'nested.key': 'exploit'
        };

        sanitizeInput(maliciousPayload);

        assert.strictEqual(maliciousPayload.username, 'admin');
        assert.strictEqual(maliciousPayload.password['$gt'], undefined);
        assert.strictEqual(maliciousPayload['nested.key'], undefined);
    });
});

