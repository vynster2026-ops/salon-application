const fs = require('fs');

// 1. Create staff-summary.html
const template = fs.readFileSync('settings.html', 'utf8');

// Replace active state in nav, if any, and set Staff Summary to active later.
// But first, let's just replace the main content block.
let summaryPage = template.replace(/<main class="dashboard-main">[\s\S]*<\/main>/, `<main class="dashboard-main">
    <header class="dashboard-header" style="margin-bottom: 30px;">
      <div>
        <h1 class="greeting">Staff Summary ✨</h1>
        <p class="subtitle">Your professional profile summary</p>
      </div>
      <div class="header-actions">
        <div class="profile-pic" style="background: var(--primary-light); color: var(--primary);">👤</div>
      </div>
    </header>

    <div style="background: white; padding: 40px; border-radius: 16px; border: 1px solid var(--border); box-shadow: 0 10px 25px rgba(0,0,0,0.02); max-width: 800px; margin: 0 auto;">
      <h2 style="margin-bottom: 20px; color: var(--primary); font-family: 'Playfair Display', serif; font-size: 24px;">Professional Summary</h2>
      
      <div id="summaryContent" style="font-size: 16px; line-height: 1.8; color: var(--fg); background: var(--bg); padding: 30px; border-radius: 12px; border-left: 4px solid var(--primary); white-space: pre-wrap;">
        Loading summary...
      </div>
      
      <div style="margin-top: 30px; text-align: right;">
        <button class="btn-outline ripple" style="padding: 10px 20px;" onclick="window.location.href='settings.html'">Edit in Settings</button>
      </div>
    </div>
</main>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    const summary = localStorage.getItem('loggedInSummary') || "No professional summary provided. Please update your profile in Settings.";
    document.getElementById('summaryContent').textContent = summary;
  });
</script>`);

fs.writeFileSync('staff-summary.html', summaryPage);

// 2. Inject nav link into all html files
const glob = require('fs').readdirSync('.');
const htmlFiles = glob.filter(f => f.endsWith('.html'));

const navItemHtml = `
      <button class="nav-item ripple" onclick="window.location.href='staff-summary.html'">
        <span class="nav-icon">📝</span> Staff Summary
      </button>
`;

for (const file of htmlFiles) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Inject the link before Settings if it doesn't already exist
    if (!content.includes('staff-summary.html')) {
        content = content.replace(/(<button class="nav-item ripple"[^>]*onclick="window\.location\.href='settings\.html'">)/, navItemHtml + '$1');
        fs.writeFileSync(file, content);
    }
}

// 3. Mark the staff-summary nav as active in staff-summary.html
let summaryFinal = fs.readFileSync('staff-summary.html', 'utf8');
summaryFinal = summaryFinal.replace(/class="nav-item ripple active"/g, 'class="nav-item ripple"');
summaryFinal = summaryFinal.replace(/<button class="nav-item ripple" onclick="window\.location\.href='staff-summary\.html'">/, '<button class="nav-item ripple active" onclick="window.location.href=\'staff-summary.html\'">');
fs.writeFileSync('staff-summary.html', summaryFinal);

console.log('Staff summary page created and added to nav.');
