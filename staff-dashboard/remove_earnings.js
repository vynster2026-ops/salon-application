const fs = require('fs');

try {
  require('child_process').execSync('git restore index.html');
  console.log('Restored index.html');
} catch (e) {
  console.log('Error restoring index.html', e.message);
}

const files = [
  'settings.html', 'services.html', 'schedule.html', 
  'payroll.html', 'index.html', 'attendance.html', 
  'analytics.html', 'clients.html'
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');

  // Remove earnings nav item
  content = content.replace(/\s*<button class="nav-item ripple(?: active)?" onclick="window\.location\.href='payroll\.html'">[\s\S]*?<span class="nav-icon">💰<\/span> Earnings[\s\S]*?<\/button>/g, '');

  // For index.html, carefully remove the Earnings & Targets card by finding the exact string
  if (file === 'index.html') {
    const earningsCardStart = content.indexOf('<!-- EARNINGS & TARGETS -->');
    if (earningsCardStart !== -1) {
      const rightColEnd = content.indexOf('</div>\n        </div>\n      </div>\n\n      <!-- RECEPTION DESK HUB VIEW -->');
      
      // Wait, there are multiple divs inside the right-col. Let's find the card's ending.
      // Or we can just use replace with regex for the specific card content.
      content = content.replace(/\s*<!-- EARNINGS & TARGETS -->[\s\S]*?View Detailed Report<\/button>\s*<\/div>\s*<\/div>/g, '');
    }
  }

  // For schedule.html, remove Earnings widgets
  if (file === 'schedule.html') {
    content = content.replace(/\s*<div class="outdoor-stat-card ripple" style="flex: 1;">\s*<div class="outdoor-stat-icon" style="background: rgba\(46, 204, 113, 0\.1\); color: #2ecc71;">💰<\/div>[\s\S]*?<div class="outdoor-stat-label" style="font-size: 9px;">Daily Earnings<\/div>[\s\S]*?<div class="outdoor-stat-value" id="outdoorDailyEarnings" style="font-size: 15px;">.*?<\/div>\s*<\/div>/g, '');
    
    // Remove Est. earnings from Shift Summary
    content = content.replace(/\s*<div style="background: var\(--primary-light\); padding: 12px; border-radius: 8px;">\s*<div style="font-size: 11px; color: var\(--primary\); font-weight: 700; text-transform: uppercase;">Est\. Earnings<\/div>\s*<div style="font-size: 18px; font-weight: 700; color: var\(--fg\); margin-top: 4px;" id="schedEstEarnings">.*?<\/div>\s*<\/div>/g, '');
  }

  // Write back
  fs.writeFileSync(file, content);
}
console.log('Removed earnings items.');
