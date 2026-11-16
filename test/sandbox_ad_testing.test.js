const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('SuperAdmin QA Sandbox & Ad Testing Test Suite', () => {
    const dbPath = path.join(__dirname, '..', 'db.json');
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

    it('should pre-seed the QA Sandbox Salon with id b_demo_sandbox', () => {
        const sandbox = db.branches.find(b => b.id === 'b_demo_sandbox');
        assert.ok(sandbox, 'QA Sandbox branch must exist in branches');
        assert.strictEqual(sandbox.name, 'Vynster Demo Salon [Sandbox]');
        assert.strictEqual(sandbox.status, 'Active');
        assert.strictEqual(sandbox.verificationStatus, 'Approved');
        assert.strictEqual(sandbox.isSandbox, true);
    });

    it('should pre-seed dedicated sandbox staff scoped strictly to b_demo_sandbox', () => {
        const sandboxStaff = db.staff.filter(s => s.branchId === 'b_demo_sandbox');
        assert.ok(sandboxStaff.length >= 2, 'Should have at least 2 demo staff members');
        assert.ok(sandboxStaff.some(s => s.name.includes('Alex Carter')), 'Alex Carter stylist should be present');
        assert.ok(sandboxStaff.some(s => s.name.includes('Zara Khan')), 'Zara Khan colorist should be present');
    });

    it('should pre-seed dedicated sandbox services scoped to b_demo_sandbox', () => {
        const sandboxServices = db.services.filter(s => s.branchId === 'b_demo_sandbox');
        assert.ok(sandboxServices.length >= 3, 'Should have at least 3 demo services');
        assert.ok(sandboxServices.some(s => s.name.includes('Signature Haircut')), 'Signature Haircut service should be present');
    });

    it('should have sandbox manager account in admins array', () => {
        const sandboxAdmin = db.admins.find(a => a.branchId === 'b_demo_sandbox' || a.email === 'sandbox@vynster.com');
        assert.ok(sandboxAdmin, 'Sandbox manager account must exist in admins');
        assert.strictEqual(sandboxAdmin.role, 'manager');
        assert.strictEqual(sandboxAdmin.displayPasscode, 'Branch@123');
    });

    it('should provide targeted promotional ad testing targets', () => {
        const sandboxAd = db.ads.find(a => a.id === 'ad_sandbox_demo');
        assert.ok(sandboxAd, 'Targeted test ad for sandbox must exist');
        assert.ok(sandboxAd.targets.includes('b_demo_sandbox'), 'Targeted ad must target b_demo_sandbox');
    });

    it('should provide global network ad campaign for testing', () => {
        const globalAd = db.ads.find(a => a.id === 'ad_global_sample');
        assert.ok(globalAd, 'Global sample ad must exist');
        assert.ok(globalAd.targets.includes('Global'), 'Global ad must target Global');
    });

    it('should match ad targets for sandbox via ID or Branch Name', () => {
        const currentBranch = 'Vynster Demo Salon [Sandbox]';
        const currentBranchId = 'b_demo_sandbox';

        const filterAd = (ad) => {
            const targets = Array.isArray(ad.targets) ? ad.targets : [ad.targets];
            return targets.some(t => {
                const s = String(t).trim().toLowerCase();
                return s === 'global' || s === 'all' ||
                    (currentBranch && s === currentBranch.trim().toLowerCase()) ||
                    (currentBranchId && s === currentBranchId.trim().toLowerCase());
            });
        };

        const sandboxAd = db.ads.find(a => a.id === 'ad_sandbox_demo');
        const globalAd = db.ads.find(a => a.id === 'ad_global_sample');

        assert.strictEqual(filterAd(sandboxAd), true, 'Targeted sandbox ad should match sandbox portal');
        assert.strictEqual(filterAd(globalAd), true, 'Global ad should match sandbox portal');
    });
});
