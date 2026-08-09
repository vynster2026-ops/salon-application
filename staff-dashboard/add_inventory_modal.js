const fs = require('fs');
const files = ['services.html', 'analytics.html'];

const modalHtml = `
  <!-- INVENTORY MODAL -->
  <div class="modal-overlay hidden" id="inventoryModalOverlay" onclick="closeInventoryModal()">
    <div class="modal-box" onclick="event.stopPropagation()" style="max-width: 400px">
      <div class="modal-head">
        <h3>Request Supplies</h3>
        <button class="close-btn" style="display: block" onclick="closeInventoryModal()">
          ✕
        </button>
      </div>
      <div class="modal-body">
        <div style="display: flex; flex-direction: column; gap: 12px">
          <div>
            <label style="font-size: 12px; color: var(--muted); font-weight: 600">Select Item</label>
            <select id="invItem" class="form-input" style="
                  width: 100%;
                  padding: 8px;
                  border: 1px solid var(--border);
                  border-radius: 6px;
                  background: var(--muted-bg);
                  color: var(--fg);
                  margin-top: 4px;
                ">
              <option value="Olaplex">Olaplex</option>
              <option value="Shampoo">Shampoo</option>
              <option value="Gloves">Gloves</option>
            </select>
          </div>
          <div>
            <label style="font-size: 12px; color: var(--muted); font-weight: 600">Quantity Needed</label>
            <input type="number" id="invQty" class="form-input" value="1" min="1" style="
                  width: 100%;
                  padding: 8px;
                  border: 1px solid var(--border);
                  border-radius: 6px;
                  background: var(--muted-bg);
                  color: var(--fg);
                  margin-top: 4px;
                " />
          </div>
          <div>
            <label style="font-size: 12px; color: var(--muted); font-weight: 600">Station / Room</label>
            <input type="text" id="invStation" class="form-input" placeholder="e.g., Station 4" style="
                  width: 100%;
                  padding: 8px;
                  border: 1px solid var(--border);
                  border-radius: 6px;
                  background: var(--muted-bg);
                  color: var(--fg);
                  margin-top: 4px;
                " />
          </div>
          <button class="btn-primary ripple" style="width: 100%; margin-top: 8px; padding: 10px"
            onclick="submitInventoryRequest()">
            Send Request
          </button>
        </div>
      </div>
    </div>
  </div>
`;

for (const file of files) {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    if (!content.includes('id="inventoryModalOverlay"')) {
      // Insert before the closing body tag or script tags
      content = content.replace('</body>', modalHtml + '\n</body>');
      fs.writeFileSync(file, content);
      console.log('Added to ' + file);
    }
  }
}
