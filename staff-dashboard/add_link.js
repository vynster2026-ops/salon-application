const fs = require('fs');


const files = fs.readdirSync('.').filter(f => f.endsWith('.html'));

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf-8');
  
  const linkHtml = `      <button class="nav-item ripple" onclick="window.location.href='clients.html'">
        <span class="nav-icon">👥</span> Client Records
      </button>
`;

  // insert after performance
  if (!content.includes('clients.html')) {
    content = content.replace(
      `<button class="nav-item ripple" onclick="window.location.href='performance.html'">
        <span class="nav-icon">📈</span> Performance
      </button>`,
      `<button class="nav-item ripple" onclick="window.location.href='performance.html'">
        <span class="nav-icon">📈</span> Performance
      </button>
${linkHtml}`
    );
    // There are some files that don't have window.location.href (like register.html might not have the full sidebar, wait, they don't have it).
    // Let's also check for active performance link.
    content = content.replace(
      `<button class="nav-item ripple active" onclick="window.location.href='performance.html'">
        <span class="nav-icon">📈</span> Performance
      </button>`,
      `<button class="nav-item ripple active" onclick="window.location.href='performance.html'">
        <span class="nav-icon">📈</span> Performance
      </button>
${linkHtml}`
    );
    fs.writeFileSync(file, content);
  }
});
console.log('Sidebar links updated!');
