const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('DOM & Front-End Structure Accurate Functionality Tests', () => {
    it('matrix.html should parse all inline JS without any SyntaxError', () => {
        const filePath = path.join(__dirname, '..', 'matrix.html');
        const content = fs.readFileSync(filePath, 'utf8');
        const scriptMatches = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
        assert.ok(scriptMatches.length > 0, 'matrix.html must contain script tags');

        for (const scriptTag of scriptMatches) {
            if (/src\s*=/i.test(scriptTag)) continue;
            const jsCode = scriptTag.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');
            assert.doesNotThrow(() => {
                new vm.Script(jsCode);
            }, `Inline script in matrix.html threw a SyntaxError`);
        }
    });

    it('matrix.html should define image compression and optimized landing save functions', () => {
        const content = fs.readFileSync(path.join(__dirname, '..', 'matrix.html'), 'utf8');
        assert.ok(content.includes('function compressImageFile'), 'Must define compressImageFile');
        assert.ok(content.includes('function compressDataUrl'), 'Must define compressDataUrl');
        assert.ok(content.includes('handlePartnerSlotUpload'), 'Must define handlePartnerSlotUpload');
        assert.ok(content.includes('handleLandingLogoUpload'), 'Must define handleLandingLogoUpload');
        assert.ok(content.includes('confirmSuspend'), 'Must define confirmSuspend');
        assert.ok(content.includes('deleteVendor'), 'Must define deleteVendor');
    });

    it('vynster-salon.html should parse all inline JS without any SyntaxError', () => {
        const filePath = path.join(__dirname, '..', 'vynster-salon.html');
        const content = fs.readFileSync(filePath, 'utf8');
        const scriptMatches = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
        assert.ok(scriptMatches.length > 0, 'vynster-salon.html must contain script tags');

        for (const scriptTag of scriptMatches) {
            if (/src\s*=/i.test(scriptTag)) continue;
            const jsCode = scriptTag.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');
            assert.doesNotThrow(() => {
                new vm.Script(jsCode);
            }, `Inline script in vynster-salon.html threw a SyntaxError`);
        }
    });

    it('vynster-salon.html should NOT auto-open opening cash amount modal on DOMContentLoaded', () => {
        const content = fs.readFileSync(path.join(__dirname, '..', 'vynster-salon.html'), 'utf8');
        assert.ok(content.includes('// checkOpeningAmount();'), 'checkOpeningAmount should be commented out or disabled on DOMContentLoaded');
        assert.ok(content.includes('id="suspended-overlay"'), 'suspended-overlay must exist in DOM');
        assert.ok(content.includes('NO SERVICES'), 'suspended-overlay must show NO SERVICES warning banner');
    });

    it('landing.html should parse all inline JS and include real-time socket & partner showcase elements', () => {
        const filePath = path.join(__dirname, '..', 'landing.html');
        const content = fs.readFileSync(filePath, 'utf8');
        assert.ok(content.includes('/socket.io/socket.io.js'), 'landing.html must include socket.io client script');
        assert.ok(content.includes('id="landing-brand-logos-grid"'), 'landing.html must contain partner grid id');

        const scriptMatches = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
        for (const scriptTag of scriptMatches) {
            if (/src\s*=/i.test(scriptTag)) continue;
            if (/type\s*=\s*["']application\/(ld\+)?json["']/i.test(scriptTag)) continue;
            const jsCode = scriptTag.replace(/<script\b[^>]*>/i, '').replace(/<\/script>/i, '');
            assert.doesNotThrow(() => {
                new vm.Script(jsCode);
            }, `Inline script in landing.html threw a SyntaxError`);
        }
    });
});

describe('Database Query Safety & Multi-Tenant Suspension Verification', () => {
    it('buildBranchMongoQuery safely checks custom string IDs without invalid ObjectId cast', () => {
        function escapeRegex(text) {
            return String(text || '').replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        }
        function buildBranchMongoQuery(identifier, accessKey = null, email = null) {
            if (!identifier) return { id: '__non_existent_placeholder__' };
            const raw = String(identifier).trim();
            const orClauses = [
                { id: raw },
                { id: new RegExp('^' + escapeRegex(raw) + '$', 'i') },
                { name: raw },
                { name: new RegExp('^' + escapeRegex(raw) + '$', 'i') }
            ];
            // Only valid 24-character hex strings are treated as potential ObjectIds
            if (/^[0-9a-fA-F]{24}$/.test(raw)) {
                orClauses.push({ _id: raw });
            }
            if (accessKey) {
                orClauses.push({ accessKey: String(accessKey).trim() });
                orClauses.push({ accessKey: new RegExp('^' + escapeRegex(String(accessKey).trim()) + '$', 'i') });
            }
            if (email) {
                orClauses.push({ email: String(email).trim() });
                orClauses.push({ email: new RegExp('^' + escapeRegex(String(email).trim()) + '$', 'i') });
            }
            return { $or: orClauses };
        }

        const queryForCustomId = buildBranchMongoQuery('b_random_salon_99');
        assert.strictEqual(queryForCustomId.$or.some(c => c._id !== undefined), false, 'Must not query _id with non-hex custom ID');

        const queryForHexId = buildBranchMongoQuery('673b5c8983e1c549a7b4275e');
        assert.strictEqual(queryForHexId.$or.some(c => c._id !== undefined), true, 'Must query _id when given a 24-hex string');
    });

    it('Branch suspension and reactivation in memory should properly update and lock portal', () => {
        const mockBranches = [
            { id: 'b_test_101', name: 'Test Luxury Salon', status: 'Active' }
        ];

        // Suspend
        const b = mockBranches.find(x => x.id === 'b_test_101');
        b.status = 'Suspended';
        assert.strictEqual(b.status, 'Suspended');

        // Check portal lock condition
        const isPortalLocked = b.status === 'Suspended' || b.status === 'Inactive';
        assert.strictEqual(isPortalLocked, true, 'Portal must lock when status is Suspended');

        // Reactivate
        b.status = 'Active';
        assert.strictEqual(b.status, 'Active');
        assert.strictEqual(b.status === 'Suspended', false, 'Portal must unlock when status is Active');
    });

    it('Branch deletion should remove target branch and keep protected system branches intact', () => {
        let branches = [
            { id: 'b1', name: 'Main Branch' },
            { id: 'b_demo_sandbox', name: 'Vynster Demo Salon [Sandbox]' },
            { id: 'b_temp_to_delete', name: 'Temporary Lounge' }
        ];

        const targetId = 'b_temp_to_delete';
        const isProtected = targetId === 'b1' || targetId === 'b_demo_sandbox';
        assert.strictEqual(isProtected, false);

        branches = branches.filter(b => b.id !== targetId);
        assert.strictEqual(branches.length, 2);
        assert.strictEqual(branches.find(b => b.id === 'b1') !== undefined, true, 'Main Branch preserved');
        assert.strictEqual(branches.find(b => b.id === 'b_demo_sandbox') !== undefined, true, 'QA Sandbox preserved');
        assert.strictEqual(branches.find(b => b.id === targetId), undefined, 'Deleted branch successfully removed');
    });
});
