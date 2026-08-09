const fs = require('fs');

const template = fs.readFileSync('settings.html', 'utf8');

let summaryPage = template.replace(/<main class="content">[\s\S]*?<\/main>/, `<main class="content">
    <div class="page-heading" style="margin-bottom: 30px;">
      <h1 class="greeting">Staff Summary ✨</h1>
      <p class="subtitle">Your professional profile summary</p>
    </div>

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
    const summary = localStorage.getItem('loggedInSummary') || 'No professional summary provided. Please update your profile in Settings.';
    document.getElementById('summaryContent').textContent = summary;
  });
</script>`);

// Make sure the active nav link is correct
summaryPage = summaryPage.replace(/class="nav-item ripple active"/g, 'class="nav-item ripple"');
summaryPage = summaryPage.replace(/<button class="nav-item ripple" onclick="window\.location\.href='staff-summary\.html'">/, '<button class="nav-item ripple active" onclick="window.location.href=\'staff-summary.html\'">');

fs.writeFileSync('staff-summary.html', summaryPage);
console.log('Fixed staff-summary.html');
