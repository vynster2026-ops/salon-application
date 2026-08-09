const fs = require('fs');

let css = fs.readFileSync('style.css', 'utf8');

// 1. Upgrade .apt-item
css = css.replace(/\.apt-item \{\s*border: 1px solid var\(--border\);\s*border-radius: 12px;\s*overflow: hidden;\s*transition: all 0\.2s;\s*cursor: pointer;\s*\}/g, `.apt-item {
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  cursor: pointer;
  background: var(--card);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
}`);

css = css.replace(/\.apt-item:hover \{\s*border-color: var\(--primary\);\s*box-shadow: 0 2px 12px rgba\(120, 40, 100, 0\.1\);\s*\}/g, `.apt-item:hover {
  border-color: var(--primary);
  box-shadow: 0 10px 25px -5px rgba(26, 107, 138, 0.15), 0 8px 10px -6px rgba(26, 107, 138, 0.1);
  transform: translateY(-2px);
}`);

// 2. Adjust .apt-main
css = css.replace(/\.apt-main \{\s*display: flex;\s*align-items: center;\s*gap: 14px;\s*padding: 12px 14px;\s*\}/g, `.apt-main {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}`);

// 3. Improve Next Client card in index.html (actually next-client-card CSS class)
if (css.includes('.next-client-card {')) {
  css = css.replace(/\.next-client-card \{\s*background: linear-gradient\(135deg, rgba\(26, 107, 138, 0\.05\) 0%, rgba\(26, 107, 138, 0\.15\) 100%\);\s*border-color: rgba\(26, 107, 138, 0\.2\);\s*\}/g, `.next-client-card {
  background: linear-gradient(135deg, rgba(26, 107, 138, 0.05) 0%, rgba(160, 64, 144, 0.08) 100%);
  border-color: var(--primary);
  box-shadow: 0 8px 20px rgba(26,107,138,0.1);
}`);
}

// 4. Append responsive media query at the end
const responsiveCSS = `
/* Premium Appointments Responsive Layout */
@media (max-width: 600px) {
  .apt-main {
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .apt-time-col {
    margin-top: 4px;
  }
  .apt-info {
    min-width: 100%;
    margin-left: 36px;
    margin-top: -6px;
  }
  .apt-actions {
    min-width: 100%;
    margin-left: 36px;
    flex-wrap: wrap;
    gap: 10px;
  }
  .btn-start, .btn-done, .btn-outline {
    flex: 1;
    text-align: center;
    padding: 10px 14px;
  }
  .apt-badge {
    margin-bottom: 4px;
  }
}
`;

if (!css.includes('Premium Appointments Responsive Layout')) {
  css += '\n' + responsiveCSS;
}

fs.writeFileSync('style.css', css);
console.log('CSS styles upgraded.');
