const fs = require('fs');
const files = fs.readdirSync('.').filter(f => f.endsWith('.html'));

const target = `      <button class="nav-item ripple" onclick="window.location.href='leave.html'">
        <span class="nav-icon">📋</span> Leave Requests
      </button>\n`;

const target2 = `      <button class="nav-item ripple" onclick="window.location.href='leave.html'">\r
        <span class="nav-icon">📋</span> Leave Requests\r
      </button>\r\n`;

for (let file of files) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Using regex to handle possible whitespace differences
    const regex = /[ \t]*<button class="nav-item ripple" onclick="window\.location\.href='leave\.html'">\s*<span class="nav-icon">📋<\/span>\s*Leave Requests\s*<\/button>\r?\n?/g;
    
    if (regex.test(content)) {
        console.log('Modifying', file);
        content = content.replace(regex, '');
        fs.writeFileSync(file, content);
    }
}
console.log('Done');
