const fs = require('fs');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const schedHtml = fs.readFileSync('schedule.html', 'utf8');

const getSidebar = (html) => {
  const start = html.indexOf('<aside class="sidebar" id="sidebar">');
  const end = html.indexOf('</aside>') + 8;
  return html.substring(start, end);
};

console.log('--- INDEX SIDEBAR ---');
console.log(getSidebar(indexHtml));
console.log('\n--- SCHEDULE SIDEBAR ---');
console.log(getSidebar(schedHtml));
