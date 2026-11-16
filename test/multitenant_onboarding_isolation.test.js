const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

// Simulated secret matching server.js
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

describe('Multi-Tenant Onboarding & Data Isolation Verification', () => {

    // Test KYC document isolation logic
    it('should strictly isolate KYC documents to Super Admin and respective salon manager only', () => {
        const mockBranches = [
            {
                id: 'b1',
                name: 'Main Branch',
                status: 'Active',
                displayPasscode: 'Main@123',
                accessKey: 'main_admin',
                aadhaarDoc: 'main_aadhaar.pdf',
                panDoc: 'main_pan.pdf',
                addressProofDoc: 'main_trade_license.pdf',
                ownerPhoto: 'https://images.unsplash.com/photo-1.jpg'
            },
            {
                id: 'b_new_test',
                name: 'Elite Glow Studio',
                status: 'Pending Review',
                verificationStatus: 'Pending',
                displayPasscode: 'Elite@789',
                accessKey: 'elite_admin',
                aadhaarDoc: 'elite_aadhaar.jpg',
                panDoc: 'elite_pan.jpg',
                addressProofDoc: 'elite_license.pdf',
                ownerPhoto: 'https://images.unsplash.com/photo-2.jpg'
            }
        ];

        // The enrichBranches filtering logic from server.js
        const enrichBranchesSim = (branchesList, requesterUser = null) => {
            const isSuperAdmin = Boolean(
                requesterUser && (
                    requesterUser.role === 'super' || 
                    (typeof requesterUser.tier === 'number' && requesterUser.tier <= 3)
                )
            );
            const requesterBranchId = requesterUser && requesterUser.branchId 
                ? String(requesterUser.branchId).toLowerCase() 
                : null;

            return branchesList.map(b => {
                const safeBranchData = Object.assign({}, b);
                delete safeBranchData.password;

                const isRespectiveSalon = Boolean(
                    requesterBranchId && b.id && String(b.id).trim().toLowerCase() === requesterBranchId
                );

                if (isSuperAdmin) {
                    safeBranchData.passcode = b.displayPasscode || 'Branch@123';
                    safeBranchData.displayPasscode = b.displayPasscode || 'Branch@123';
                } else if (isRespectiveSalon) {
                    safeBranchData.passcode = b.displayPasscode || 'Branch@123';
                    safeBranchData.displayPasscode = b.displayPasscode || 'Branch@123';
                } else {
                    delete safeBranchData.aadhaarDoc;
                    delete safeBranchData.panDoc;
                    delete safeBranchData.addressProofDoc;
                    delete safeBranchData.ownerPhoto;
                    delete safeBranchData.displayPasscode;
                    delete safeBranchData.passcode;
                    delete safeBranchData.accessKey;
                }
                return safeBranchData;
            });
        };

        // 1. Unauthenticated public request -> sensitive KYC fields must be stripped for ALL salons
        const publicResult = enrichBranchesSim(mockBranches, null);
        assert.strictEqual(publicResult.length, 2);
        assert.strictEqual(publicResult[0].aadhaarDoc, undefined, 'Public must not see b1 aadhaar');
        assert.strictEqual(publicResult[0].displayPasscode, undefined, 'Public must not see b1 passcode');
        assert.strictEqual(publicResult[1].aadhaarDoc, undefined, 'Public must not see new salon aadhaar');
        assert.strictEqual(publicResult[1].panDoc, undefined, 'Public must not see new salon pan');
        assert.strictEqual(publicResult[1].addressProofDoc, undefined, 'Public must not see new salon license');
        assert.strictEqual(publicResult[1].ownerPhoto, undefined, 'Public must not see new salon owner photo');

        // 2. Super Admin (Tier 1/2/3) -> ALL onboarding KYC documents and passcodes must be visible for verification
        const superAdminUser = { role: 'super', tier: 2, name: 'Admin Manager' };
        const superResult = enrichBranchesSim(mockBranches, superAdminUser);
        assert.strictEqual(superResult[1].aadhaarDoc, 'elite_aadhaar.jpg', 'Super Admin must see aadhaar for KYC');
        assert.strictEqual(superResult[1].panDoc, 'elite_pan.jpg', 'Super Admin must see PAN for KYC');
        assert.strictEqual(superResult[1].displayPasscode, 'Elite@789', 'Super Admin must see passcode');

        // 3. Manager of Main Branch (b1) -> sees b1 docs, but MUST NOT see Elite salon KYC docs
        const b1Manager = { role: 'manager', branchId: 'b1', name: 'Main Manager' };
        const b1Result = enrichBranchesSim(mockBranches, b1Manager);
        assert.strictEqual(b1Result[0].displayPasscode, 'Main@123', 'Manager of b1 sees own passcode');
        assert.strictEqual(b1Result[1].aadhaarDoc, undefined, 'Manager of b1 must NOT see other salon aadhaar');
        assert.strictEqual(b1Result[1].displayPasscode, undefined, 'Manager of b1 must NOT see other salon passcode');

        // 4. Manager of Elite Glow Studio (b_new_test) -> sees own docs, but MUST NOT see b1 docs
        const eliteManager = { role: 'manager', branchId: 'b_new_test', name: 'Elite Manager' };
        const eliteResult = enrichBranchesSim(mockBranches, eliteManager);
        assert.strictEqual(eliteResult[1].aadhaarDoc, 'elite_aadhaar.jpg', 'Elite manager sees own aadhaar');
        assert.strictEqual(eliteResult[1].displayPasscode, 'Elite@789', 'Elite manager sees own passcode');
        assert.strictEqual(eliteResult[0].aadhaarDoc, undefined, 'Elite manager must NOT see b1 aadhaar');
        assert.strictEqual(eliteResult[0].displayPasscode, undefined, 'Elite manager must NOT see b1 passcode');
    });

    // Test Settings permission check for Tier 2
    it('should permit Tier 1 and Tier 2 admins to save settings while rejecting unauthorized users', () => {
        const canSaveSettings = (user) => {
            return Boolean(user && (
                user.role === 'owner' ||
                (user.role === 'super' && (!user.tier || user.tier <= 2))
            ));
        };

        assert.strictEqual(canSaveSettings({ role: 'super', tier: 1 }), true, 'Tier 1 must save settings');
        assert.strictEqual(canSaveSettings({ role: 'super', tier: 2 }), true, 'Tier 2 must save settings');
        assert.strictEqual(canSaveSettings({ role: 'super', tier: 3 }), false, 'Tier 3 BD must not save platform settings');
        assert.strictEqual(canSaveSettings({ role: 'manager', tier: 2, branchId: 'b1' }), false, 'Branch manager must not save platform settings');
        assert.strictEqual(canSaveSettings(null), false, 'Unauthenticated user must not save settings');
    });

    // Test Client isolation between Main Branch and newly onboarded salon
    it('should isolate onboarded salon clients from Main Branch and other salons', () => {
        const clientsDb = [
            { id: 'c1', name: 'Main VIP Client 1', branchId: 'b1', branch: 'Main Branch' },
            { id: 'c2', name: 'Main VIP Client 2', branchId: 'b1', branch: 'Main Branch' },
            { id: 'c3', name: 'Elite New Client 1', branchId: 'b_new_test', branch: 'Elite Glow Studio' },
            { id: 'c4', name: 'Elite New Client 2', branchId: 'b_new_test', branch: 'Elite Glow Studio' }
        ];

        const filterClients = (targetBranch, user) => {
            const isSuperAdmin = user && (user.role === 'super' || (typeof user.tier === 'number' && user.tier <= 3));
            const effectiveBranch = isSuperAdmin ? (targetBranch || null) : (user && user.branchId ? user.branchId : 'b1');

            if (!effectiveBranch || effectiveBranch === 'all') return clientsDb;
            const targetLower = String(effectiveBranch).trim().toLowerCase();
            return clientsDb.filter(c => {
                const cBranchId = String(c.branchId || '').trim().toLowerCase();
                const cBranchName = String(c.branch || '').trim().toLowerCase();
                return cBranchId === targetLower || cBranchName === targetLower;
            });
        };

        // Querying for Main Branch must return only b1 clients
        const mainBranchClients = filterClients('b1', { role: 'manager', branchId: 'b1' });
        assert.strictEqual(mainBranchClients.length, 2);
        assert.ok(mainBranchClients.every(c => c.branchId === 'b1'), 'All clients must be b1');

        // Querying for Elite Glow Studio must return only b_new_test clients
        const eliteClients = filterClients('b_new_test', { role: 'manager', branchId: 'b_new_test' });
        assert.strictEqual(eliteClients.length, 2);
        assert.ok(eliteClients.every(c => c.branchId === 'b_new_test'), 'All clients must be b_new_test');

        // Main branch manager trying to query elite salon via query params is locked to b1
        const hijackedAttempt = filterClients('b_new_test', { role: 'manager', branchId: 'b1' });
        assert.strictEqual(hijackedAttempt.length, 2);
        assert.ok(hijackedAttempt.every(c => c.branchId === 'b1'), 'Manager locked to assigned branch');
    });

    // Test Services isolation
    it('should not leak onboarded salon custom services into Main Branch', () => {
        const servicesDb = [
            { id: 'svc1', name: 'Royal Hair Cut', branchId: 'global' },
            { id: 'svc2', name: 'Main Special Facial', branchId: 'b1', branch: 'Main Branch' },
            { id: 'svc3', name: 'Elite Gold Radiance Spa', branchId: 'b_new_test', branch: 'Elite Glow Studio' }
        ];

        const filterServices = (targetBranch) => {
            const targetLower = String(targetBranch).trim().toLowerCase();
            return servicesDb.filter(s => {
                const sBranchId = String(s.branchId || '').trim().toLowerCase();
                const sBranchName = String(s.branch || '').trim().toLowerCase();
                if (!sBranchId || sBranchId === 'global' || sBranchId === 'all') return true;
                if (sBranchId === targetLower || sBranchName === targetLower) return true;
                return false;
            });
        };

        const mainServices = filterServices('b1');
        assert.strictEqual(mainServices.length, 2, 'Main branch should get global + b1 only');
        assert.ok(!mainServices.some(s => s.name === 'Elite Gold Radiance Spa'), 'Elite custom service must NOT appear in Main Branch');

        const eliteServices = filterServices('b_new_test');
        assert.strictEqual(eliteServices.length, 2, 'Elite salon should get global + elite custom');
        assert.ok(eliteServices.some(s => s.name === 'Elite Gold Radiance Spa'), 'Elite custom service present in Elite salon');
    });

    // Test Staff isolation
    it('should not leak onboarded salon staff into Main Branch or other salons', () => {
        const staffDb = [
            { id: 'st1', name: 'Rohan Sharma', branchId: 'b1', branch: 'Main Branch' },
            { id: 'st2', name: 'Kavita Rao', branchId: 'b_new_test', branch: 'Elite Glow Studio' }
        ];

        const filterStaff = (targetBranch) => {
            const targetLower = String(targetBranch).trim().toLowerCase();
            return staffDb.filter(s => {
                const sBranchId = String(s.branchId || '').trim().toLowerCase();
                const sBranchName = String(s.branch || '').trim().toLowerCase();
                if (sBranchId === targetLower || sBranchName === targetLower) return true;
                return false;
            });
        };

        const mainStaff = filterStaff('b1');
        assert.strictEqual(mainStaff.length, 1);
        assert.strictEqual(mainStaff[0].name, 'Rohan Sharma');

        const eliteStaff = filterStaff('b_new_test');
        assert.strictEqual(eliteStaff.length, 1);
        assert.strictEqual(eliteStaff[0].name, 'Kavita Rao');
    });
});
