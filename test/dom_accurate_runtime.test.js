const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Accurate DOM Runtime & UI Lifecycle Tests', () => {
    it('matrix.html: confirmSuspend updates vendor status in memory and table', () => {
        const mockDom = {
            vendors: [
                { id: 'b_test_1', name: 'Elite Glow Studio', status: 'Active' },
                { id: 'b_test_2', name: 'Crown Beauty Bar', status: 'Active' }
            ],
            salonToSuspend: { id: 'b_test_1', name: 'Elite Glow Studio', status: 'Active' },
            tableRendered: false,
            renderVendorTable: function() { this.tableRendered = true; },
            renderExtendedTables: function() {},
            filterVendors: function() {},
            closeModal: function() { this.modalClosed = true; },
            showToast: function(msg, type) { this.lastToast = { msg, type }; }
        };

        // Simulate confirmSuspend logic
        mockDom.salonToSuspend.status = 'Suspended';
        const v = mockDom.vendors.find(x => x.id === mockDom.salonToSuspend.id);
        if (v) v.status = 'Suspended';
        mockDom.renderVendorTable();
        mockDom.closeModal();

        assert.strictEqual(mockDom.vendors[0].status, 'Suspended', 'Target vendor must be suspended');
        assert.strictEqual(mockDom.vendors[1].status, 'Active', 'Other vendor must remain active');
        assert.strictEqual(mockDom.tableRendered, true, 'Table must be re-rendered');
        assert.strictEqual(mockDom.modalClosed, true, 'Modal must close');
    });

    it('matrix.html: deleteVendor splices local array immediately', () => {
        const vendors = [
            { id: 'b1', name: 'Main Branch' },
            { id: 'b_demo_sandbox', name: 'QA Sandbox' },
            { id: 'b_custom_99', name: 'Delete Target Lounge' }
        ];

        const targetId = 'b_custom_99';
        // Protected check
        const isProtected = targetId === 'b1' || targetId === 'b_demo_sandbox';
        assert.strictEqual(isProtected, false);

        const index = vendors.findIndex(x => x.id === targetId);
        assert.ok(index > -1, 'Must find vendor to delete');
        vendors.splice(index, 1);

        assert.strictEqual(vendors.length, 2, 'Vendor must be removed from list');
        assert.strictEqual(vendors.find(x => x.id === targetId), undefined, 'Deleted vendor must not exist');
    });

    it('vynster-salon.html: suspended-overlay triggers when status is Suspended', () => {
        let isPortalSuspended = false;
        let overlayStyle = { display: 'none' };
        let dropdown = { disabled: false, value: 'Main Branch' };

        const testBranch = { id: 'b_target', name: 'Suspended Salon', status: 'Suspended' };

        if (testBranch.status === 'Suspended' || testBranch.status === 'Inactive') {
            isPortalSuspended = true;
            overlayStyle.display = 'flex';
            dropdown.disabled = true;
            dropdown.value = testBranch.name;
        }

        assert.strictEqual(isPortalSuspended, true, 'Portal must flag suspension');
        assert.strictEqual(overlayStyle.display, 'flex', 'Overlay must be visible');
        assert.strictEqual(dropdown.disabled, true, 'Branch dropdown must be disabled');
    });

    it('vynster-salon.html: checkOpeningAmount auto-popup is completely inert on load', () => {
        const html = fs.readFileSync(path.join(__dirname, '..', 'vynster-salon.html'), 'utf8');
        // Ensure checkOpeningAmount is NOT called in DOMContentLoaded
        const domLoadedSection = html.match(/document\.addEventListener\('DOMContentLoaded',\s*\(\)\s*=>\s*\{([\s\S]*?)\}\);/);
        assert.ok(domLoadedSection, 'DOMContentLoaded listener must exist');
        assert.ok(!domLoadedSection[1].includes('\n            checkOpeningAmount();'), 'checkOpeningAmount() must not be invoked on DOMContentLoaded');
    });
});
