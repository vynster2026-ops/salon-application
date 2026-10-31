const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Rate Limiter & Memory Protection Test Suite', () => {
    it('should track request counts per IP and block excess requests', () => {
        const store = new Map();
        const windowMs = 1000;
        const max = 3;

        function checkRateLimit(ip, path) {
            const key = path + ':' + ip;
            const now = Date.now();
            let record = store.get(key);
            if (!record || now - record.startTime > windowMs) {
                record = { count: 1, startTime: now, windowMs };
                store.set(key, record);
                return { allowed: true, count: 1 };
            }
            record.count++;
            if (record.count > max) {
                return { allowed: false, count: record.count };
            }
            return { allowed: true, count: record.count };
        }

        const ip = '192.168.1.100';
        const route = '/api/bookings';

        // Requests 1, 2, 3 should pass
        assert.strictEqual(checkRateLimit(ip, route).allowed, true);
        assert.strictEqual(checkRateLimit(ip, route).allowed, true);
        assert.strictEqual(checkRateLimit(ip, route).allowed, true);

        // Request 4 should be blocked
        const blockedRes = checkRateLimit(ip, route);
        assert.strictEqual(blockedRes.allowed, false);
        assert.strictEqual(blockedRes.count, 4);
    });

    it('should evict expired entries to prevent memory leaks', () => {
        const store = new Map();
        const now = Date.now();
        
        // Add active entry and expired entry
        store.set('/api/active:127.0.0.1', { count: 1, startTime: now, windowMs: 60000 });
        store.set('/api/expired:127.0.0.1', { count: 1, startTime: now - 100000, windowMs: 60000 });

        assert.strictEqual(store.size, 2);

        // Prune logic
        for (const [key, record] of store.entries()) {
            if (now - record.startTime > record.windowMs) {
                store.delete(key);
            }
        }

        assert.strictEqual(store.size, 1);
        assert.ok(store.has('/api/active:127.0.0.1'));
        assert.strictEqual(store.has('/api/expired:127.0.0.1'), false);
    });
});

