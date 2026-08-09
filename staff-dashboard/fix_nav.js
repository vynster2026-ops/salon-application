const fs = require('fs');

const glob = require('fs').readdirSync('.');
const htmlFiles = glob.filter(f => f.endsWith('.html'));

for (const file of htmlFiles) {
    let content = fs.readFileSync(file, 'utf8');

    // 1. Remove " active" from all nav-item ripples
    content = content.replace(/class="nav-item ripple active"/g, 'class="nav-item ripple"');

    // 2. Remove all existing nav-dots to clean up
    content = content.replace(/\s*<span class="nav-dot"><\/span>/g, '');

    // 3. Find the button for the current file and make it active, and inject the nav-dot
    const fileTarget = `onclick="window.location.href='${file}'"`;
    
    // We want to replace `<button class="nav-item ripple" onclick="window.location.href='currentfile.html'">...`
    // with `<button class="nav-item ripple active" onclick="...">...\n<span class="nav-dot"></span>`
    // Using a regex to match the button opening and its contents until the closing </button>
    const regex = new RegExp(`(<button class="nav-item ripple" ${fileTarget.replace(/([.'])/g, '\\$1')}>[\\s\\S]*?)(</button>)`);
    
    if (content.match(regex)) {
        content = content.replace(regex, `$1\n        <span class="nav-dot"></span>\n      $2`);
        // Also add the 'active' class
        content = content.replace(new RegExp(`class="nav-item ripple" ${fileTarget.replace(/([.'])/g, '\\$1')}`), `class="nav-item ripple active" ${fileTarget}`);
    }

    fs.writeFileSync(file, content);
}
console.log('Fixed active states on all nav menus');
