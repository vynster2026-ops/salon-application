const fs = require('fs');
let html = fs.readFileSync('settings.html', 'utf8');

// The CSS styles we need to add
const newCss = `
  <style>
    .settings-container {
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    
    .settings-sidebar {
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      gap: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    
    .settings-tab {
      background: none;
      border: none;
      color: var(--muted);
      padding: 12px 16px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      white-space: nowrap;
      border-radius: 8px;
      transition: all 0.2s;
    }
    
    .settings-tab:hover {
      background: var(--muted-bg);
      color: var(--fg);
    }
    
    .settings-tab.active {
      background: var(--primary);
      color: white;
    }

    .settings-content-area {
      flex: 1;
    }
    
    .settings-tab-pane {
      display: none;
      animation: fadeIn 0.3s ease-out;
    }
    
    .settings-tab-pane.active {
      display: block;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (min-width: 768px) {
      .settings-container {
        flex-direction: row;
        align-items: flex-start;
      }
      .settings-sidebar {
        flex-direction: column;
        width: 240px;
        flex-shrink: 0;
        border-bottom: none;
        border-right: 1px solid var(--border);
        padding-right: 24px;
        padding-bottom: 0;
      }
      .settings-tab {
        text-align: left;
      }
    }
`;

// Extract sections from the HTML string to regroup them
// This is done via string replacement. We will inject the tabs before `<form id="settingsForm">`

// Wrap sections in tab panes
html = html.replace('<!-- 1. PERSONAL INFO -->', '<div id="tab-general" class="settings-tab-pane active">\n          <!-- 1. PERSONAL INFO -->');
html = html.replace('<!-- 3. BOOKING & CALENDAR PREFERENCES -->', '</div>\n\n          <div id="tab-preferences" class="settings-tab-pane">\n          <!-- 3. BOOKING & CALENDAR PREFERENCES -->');
html = html.replace('<!-- 5. PORTFOLIO & SOCIAL MEDIA -->', '</div>\n\n          <div id="tab-portfolio" class="settings-tab-pane">\n          <!-- 5. PORTFOLIO & SOCIAL MEDIA -->');
html = html.replace('<!-- 6. COMPLIANCE & FINANCIALS -->', '</div>\n\n          <div id="tab-security" class="settings-tab-pane">\n          <!-- 6. COMPLIANCE & FINANCIALS -->');
html = html.replace('<div id="formActions"', '</div>\n\n          <div id="formActions"');

// Insert tab navigation inside the main card
const tabNav = `
        <div class="settings-container">
          <div class="settings-sidebar">
            <button type="button" class="settings-tab active" onclick="switchSettingsTab('tab-general', this)">General Profile</button>
            <button type="button" class="settings-tab" onclick="switchSettingsTab('tab-portfolio', this)">Portfolio & Social</button>
            <button type="button" class="settings-tab" onclick="switchSettingsTab('tab-preferences', this)">Preferences</button>
            <button type="button" class="settings-tab" onclick="switchSettingsTab('tab-security', this)">Security & Legal</button>
          </div>
          
          <div class="settings-content-area">
`;

// Replace the <form id="settingsForm"...> opening tag
html = html.replace(/<form id="settingsForm"([^>]*)>/, '<form id="settingsForm"$1>\n' + tabNav);
html = html.replace(/<\/form>/, '          </div>\n        </div>\n        </form>');

// Add the CSS
html = html.replace('<style>', newCss + '\n    ');

// Add the JS function
const jsLogic = `
    function switchSettingsTab(tabId, btnElement) {
      // Hide all panes
      document.querySelectorAll('.settings-tab-pane').forEach(pane => pane.classList.remove('active'));
      // Remove active class from all buttons
      document.querySelectorAll('.settings-tab').forEach(btn => btn.classList.remove('active'));
      
      // Show selected pane
      document.getElementById(tabId).classList.add('active');
      // Highlight button
      btnElement.classList.add('active');
    }
`;
html = html.replace('function toggleEditMode() {', jsLogic + '\n    function toggleEditMode() {');

// Because we moved "Portfolio" to its own tab, let's keep the user's focus clean
// Also, Edit Mode toggle should probably happen outside the tabs so it applies globally, which it does.
// Save settings should also work correctly because all inputs are inside the form.

fs.writeFileSync('settings.html', html);
console.log('Successfully refactored settings layout to tabs');
