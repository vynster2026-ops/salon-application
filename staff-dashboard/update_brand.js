const fs = require('fs');
const glob = require('fs').readdirSync('.');

const htmlFiles = glob.filter(f => f.endsWith('.html'));

for (const file of htmlFiles) {
    let content = fs.readFileSync(file, 'utf8');

    // 1. Replace GlowSuite in title tags
    content = content.replace(/<title>GlowSuite/g, '<title>Srijes');
    
    // 2. Replace GlowSuite in footer
    content = content.replace(/GlowSuite Salon Suite/g, 'Srijes Salon');

    // 3. Replace old tagline in login/register
    content = content.replace(/<p class="brand-sub">A Complete Beauty Destination For Women<\/p>/g, '<p class="brand-sub">the beauty destination</p>');

    // 4. Ensure index.html and others have the correct sidebar branding if they just have <div class="brand-name">Srijes</div>
    // Note: We use a regex that matches exactly <div class="brand-name">Srijes</div>
    content = content.replace(/<div class="brand-name">Srijes<\/div>/g, '<div class="brand-name" style="line-height: 1.1;">Srijes<br><span style="font-size: 11px; font-weight: normal; color: var(--muted);">the beauty destination</span></div>');

    fs.writeFileSync(file, content);
}
console.log('Brand updated.');
