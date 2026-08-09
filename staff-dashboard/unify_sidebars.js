const fs = require('fs');
const glob = require('fs').readdirSync('.');
const htmlFiles = glob.filter(f => f.endsWith('.html'));

const getUnifiedNav = (fileName) => {
  const items = [
    { name: 'My Dashboard', icon: '⊞', href: 'index.html', click: `window.location.href='index.html'` },
    { name: 'My Schedule', icon: '📅', href: 'schedule.html', click: `window.location.href='schedule.html'` },
    { name: 'Attendance', icon: '🕐', href: 'attendance.html', click: `window.location.href='attendance.html'` },
    { name: 'Client Records', icon: '👥', href: 'clients.html', click: `window.location.href='clients.html'` },
    { name: 'Services', icon: '✂️', href: 'services.html', click: `window.location.href='services.html'` },
    { name: 'Analytics', icon: '📊', href: 'analytics.html', click: `window.location.href='analytics.html'` },
    { name: 'Request Supplies', icon: '📦', href: '#', click: `openInventoryModal()` },
    { name: 'Staff Summary', icon: '📝', href: 'staff-summary.html', click: `window.location.href='staff-summary.html'` },
    { name: 'Settings', icon: '⚙️', href: 'settings.html', click: `window.location.href='settings.html'` }
  ];

  let navHtml = `    <nav class="sidebar-nav">\n`;
  for (const item of items) {
    const isActive = (item.href === fileName);
    const activeClass = isActive ? ' active' : '';
    const dotHtml = isActive ? `\n        <span class="nav-dot"></span>` : '';
    navHtml += `      <button class="nav-item ripple${activeClass}" onclick="${item.click}">\n`;
    navHtml += `        <span class="nav-icon">${item.icon}</span> ${item.name}${dotHtml}\n`;
    navHtml += `      </button>\n`;
  }
  navHtml += `    </nav>`;
  return navHtml;
};

for (const file of htmlFiles) {
    if (file === 'customer-checkout.html' || file === 'login.html' || file === 'register.html') continue; // Skip pages without standard sidebar

    let content = fs.readFileSync(file, 'utf8');
    const startIdx = content.indexOf('<aside class="sidebar" id="sidebar">');
    let endIdx = content.indexOf('</aside>', startIdx);
    if (startIdx === -1 || endIdx === -1) continue;
    endIdx += 8;

    const brandHeader = `<aside class="sidebar" id="sidebar">
    <div class="sidebar-brand">
      <div class="brand-logo-sidebar" style="width: 40px; height: 40px; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #fff; margin-right: 12px; border: 1px solid var(--sidebar-border);">
          <img src="media__1778746751509.png" style="width: 140px; height: auto; transform: translate(5px, 0px);">
      </div>
      <div>
        <div class="brand-name" style="line-height: 1.1;">Srijes<br><span style="font-size: 11px; font-weight: normal; color: var(--muted);">the beauty destination</span></div>
      </div>
      <button class="close-btn" id="closeSidebar" onclick="closeSidebar()">
        ✕
      </button>
    </div>

    <div class="staff-badge">
      <div class="staff-avatar-sm" id="sidebarAvatar">PS</div>
      <div class="staff-badge-info">
        <div class="staff-badge-name" id="sidebarName">Priya Sharma</div>
        <div class="staff-badge-role" id="sidebarRole">
          Senior Stylist · 9AM–6PM
        </div>
      </div>
      <div class="status-dot active" id="sidebarDot"></div>
    </div>\n\n`;

    const unifiedSidebar = brandHeader + getUnifiedNav(file) + `\n  </aside>`;

    content = content.substring(0, startIdx) + unifiedSidebar + content.substring(endIdx);
    fs.writeFileSync(file, content);
}
console.log('Unification complete');
