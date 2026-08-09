const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');

// The file is corrupted between page-heading and stats-grid
// Let's restore the entire section from page-heading to stats-grid
const fixedSection = `      <!-- PAGE HEADING -->
      <div class="page-heading">
        <div>
          <h1 class="greeting" id="greeting">Good afternoon, Priya ✨</h1>
          <p class="shift-line">
            Your shift today:
            <strong id="shiftLine">9:00 AM – 6:00 PM</strong>
          </p>
        </div>
      </div>

      <!-- SECTIONS CONTAINER -->
      <div id="dashboardSection" class="content-section">
        <!-- QUICK ACTIONS -->
        <div class="quick-actions">
          <button class="btn-action ripple" onclick="openServiceTypeModal('walkin')">
            <span class="action-icon">🚶</span> Walk-in Services
          </button>
          <button class="btn-action ripple" onclick="openServiceTypeModal('preschedule')">
            <span class="action-icon">📅</span> Pre-schedule
          </button>
          <button class="btn-action ripple" onclick="openInventoryModal()">
            <span class="action-icon">📦</span> Request Supplies
          </button>
          <button class="btn-action ripple" onclick="window.location.href='clients.html'">
            <span class="action-icon">👥</span> View Clients
          </button>
        </div>

        <!-- STATS CARDS -->
        <div class="stats-grid" id="statsGrid"></div>`;

content = content.replace(/<!-- PAGE HEADING -->[\s\S]*?<div class="stats-grid" id="statsGrid"><\/div>/, fixedSection);
fs.writeFileSync('index.html', content);
console.log("Restored");
