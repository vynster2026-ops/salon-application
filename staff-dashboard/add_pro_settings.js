const fs = require('fs');
let content = fs.readFileSync('settings.html', 'utf8');

const insertionPoint = `          <!-- 3. COMPLIANCE & FINANCIALS -->`;
const newSections = `
          <!-- 3. BOOKING & CALENDAR PREFERENCES -->
          <div class="settings-section">
            <h3 class="section-title">Booking & Calendar Preferences</h3>
            <div class="form-grid">
              <div class="form-group full-width" style="display: flex; align-items: center; justify-content: space-between; background: var(--muted-bg); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
                <div>
                  <strong style="color: var(--fg); font-size: 15px;">Accept Online Bookings</strong>
                  <p style="color: var(--muted); font-size: 13px; margin-top: 4px; max-width: 450px;">Allow clients to book you directly from the online booking portal.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="setOnlineBooking" checked disabled class="pro-toggle" />
                  <span class="slider"></span>
                </label>
              </div>

              <div class="form-group">
                <label>Calendar Sync</label>
                <div style="display: flex; gap: 10px;">
                  <button type="button" class="btn-outline ripple pro-btn" style="flex: 1;" disabled id="btnSyncGoogle" onclick="showToast('Google Calendar Synced!', 'success', '📅')">Sync Google</button>
                  <button type="button" class="btn-outline ripple pro-btn" style="flex: 1;" disabled id="btnSyncApple" onclick="showToast('Apple Calendar Synced!', 'success', '📅')">Sync Apple</button>
                </div>
              </div>
              <div class="form-group">
                <label>Service Buffer Time</label>
                <select id="setBufferTime" class="form-input readonly-style pro-select" disabled>
                  <option value="0">None</option>
                  <option value="5">5 minutes</option>
                  <option value="10" selected>10 minutes</option>
                  <option value="15">15 minutes</option>
                </select>
              </div>
            </div>
          </div>

          <!-- 4. NOTIFICATION PREFERENCES -->
          <div class="settings-section">
            <h3 class="section-title">Notification Preferences</h3>
            <div class="form-grid">
              <div class="form-group full-width" style="background: var(--muted-bg); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border);">
                  <div style="font-weight: 600; font-size: 14px;">New Appointment Booked</div>
                  <div style="display: flex; gap: 16px; font-size: 13px;">
                    <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="notifApptEmail" checked disabled class="pro-toggle"> Email</label>
                    <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="notifApptSms" checked disabled class="pro-toggle"> SMS</label>
                  </div>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border);">
                  <div style="font-weight: 600; font-size: 14px;">Appointment Changes / Cancellations</div>
                  <div style="display: flex; gap: 16px; font-size: 13px;">
                    <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="notifChangeEmail" checked disabled class="pro-toggle"> Email</label>
                    <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="notifChangeSms" checked disabled class="pro-toggle"> SMS</label>
                  </div>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <div style="font-weight: 600; font-size: 14px;">Daily Schedule Summary</div>
                  <div style="display: flex; gap: 16px; font-size: 13px;">
                    <label style="display: flex; align-items: center; gap: 6px;"><input type="checkbox" id="notifDailyEmail" checked disabled class="pro-toggle"> Email</label>
                    <label style="display: flex; align-items: center; gap: 6px; visibility: hidden;"><input type="checkbox" disabled> SMS</label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 5. PORTFOLIO & SOCIAL MEDIA -->
          <div class="settings-section">
            <h3 class="section-title">Portfolio & Social Media</h3>
            <div class="form-grid">
              <div class="form-group">
                <label>Instagram Handle</label>
                <div style="display: flex; align-items: center;">
                  <span style="padding: 10px 12px; background: var(--border); border-radius: 8px 0 0 8px; color: var(--muted); border: 1px solid var(--border); border-right: none;">@</span>
                  <input type="text" id="setInstagram" class="form-input readonly-style pro-input" style="border-radius: 0 8px 8px 0;" placeholder="Not provided" value="priya.styles" readonly />
                </div>
              </div>
              <div class="form-group">
                <label>Portfolio Website</label>
                <input type="url" id="setPortfolioUrl" class="form-input readonly-style pro-input" placeholder="Not provided" value="" readonly />
              </div>
              <div class="form-group full-width" style="display: flex; align-items: center; justify-content: space-between; background: var(--muted-bg); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-top: 8px;">
                <div>
                  <strong style="color: var(--fg); font-size: 15px;">Show Public Reviews</strong>
                  <p style="color: var(--muted); font-size: 13px; margin-top: 4px; max-width: 450px;">Display client ratings and reviews on your online booking profile.</p>
                </div>
                <label class="toggle-switch">
                  <input type="checkbox" id="setShowReviews" checked disabled class="pro-toggle" />
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </div>

          <!-- 6. COMPLIANCE & FINANCIALS -->`;

content = content.replace(insertionPoint, newSections);
content = content.replace('<!-- 4. SECURITY -->', '<!-- 7. SECURITY -->');

// Update JS for toggleEditMode
const oldToggleEditMode = `document.getElementById('loginAlertsToggle').disabled = !isEditMode;`;
const newToggleEditMode = oldToggleEditMode + `
      document.querySelectorAll('.pro-toggle').forEach(cb => cb.disabled = !isEditMode);
      document.querySelectorAll('.pro-btn').forEach(btn => btn.disabled = !isEditMode);
      document.querySelectorAll('.pro-select').forEach(sel => {
        sel.disabled = !isEditMode;
        sel.classList.toggle('readonly-style', !isEditMode);
      });
      document.querySelectorAll('.pro-input').forEach(input => {
        input.readOnly = !isEditMode;
        input.classList.toggle('readonly-style', !isEditMode);
      });
`;
content = content.replace(oldToggleEditMode, newToggleEditMode);

// Update JS for saveSettings
const oldSaveSettings = `localStorage.setItem('loggedInSpecialties', JSON.stringify(checkedSpecs));`;
const newSaveSettings = oldSaveSettings + `
      localStorage.setItem('loggedInInstagram', document.getElementById('setInstagram').value);
      localStorage.setItem('loggedInPortfolio', document.getElementById('setPortfolioUrl').value);
      localStorage.setItem('loggedInBuffer', document.getElementById('setBufferTime').value);
      localStorage.setItem('loggedInOnlineBookings', document.getElementById('setOnlineBooking').checked);
      localStorage.setItem('loggedInShowReviews', document.getElementById('setShowReviews').checked);
`;
content = content.replace(oldSaveSettings, newSaveSettings);

// Add init method to load saved settings
const oldInit = `let isEditMode = false;`;
const newInit = oldInit + `
    document.addEventListener('DOMContentLoaded', () => {
      if (localStorage.getItem('loggedInInstagram')) document.getElementById('setInstagram').value = localStorage.getItem('loggedInInstagram');
      if (localStorage.getItem('loggedInPortfolio')) document.getElementById('setPortfolioUrl').value = localStorage.getItem('loggedInPortfolio');
      if (localStorage.getItem('loggedInBuffer')) document.getElementById('setBufferTime').value = localStorage.getItem('loggedInBuffer');
      if (localStorage.getItem('loggedInOnlineBookings') !== null) document.getElementById('setOnlineBooking').checked = localStorage.getItem('loggedInOnlineBookings') === 'true';
      if (localStorage.getItem('loggedInShowReviews') !== null) document.getElementById('setShowReviews').checked = localStorage.getItem('loggedInShowReviews') === 'true';
    });
`;
content = content.replace(oldInit, newInit);

fs.writeFileSync('settings.html', content);
console.log('Settings successfully updated');
