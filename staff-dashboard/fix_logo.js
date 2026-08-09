const fs = require('fs');
const glob = require('fs').readdirSync('.');
const htmlFiles = glob.filter(f => f.endsWith('.html'));

for (const file of htmlFiles) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/<div class="brand-logo-sidebar"[\s\S]*?<img src="media__1778746751509\.png"[\s\S]*?<\/div>/, `<div class="brand-icon" style="font-size: 24px; color: var(--primary); margin-right: 12px;">✦</div>`);
    fs.writeFileSync(file, content);
}
console.log('Fixed broken image logo in sidebars');
