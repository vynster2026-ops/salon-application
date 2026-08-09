const fs = require('fs');

// 1. Remove Earnings from app.js
let appJs = fs.readFileSync('app.js', 'utf8');
appJs = appJs.replace(/\{\s*icon:\s*"💰",\s*bg:\s*"#f0ebfa",\s*label:\s*"Earnings & Tips"[\s\S]*?\},/, '');
fs.writeFileSync('app.js', appJs);

// 2. Modify style.css for single line layout
let css = fs.readFileSync('style.css', 'utf8');
css = css.replace(/\.stats-grid\s*\{[\s\S]*?\}/, `.stats-grid {
  display: flex;
  overflow-x: auto;
  gap: 14px;
  margin-bottom: 24px;
  padding-bottom: 8px;
  flex-wrap: nowrap;
}

.stats-grid::-webkit-scrollbar {
  height: 6px;
}
.stats-grid::-webkit-scrollbar-track {
  background: transparent;
}
.stats-grid::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 10px;
}`);

css = css.replace(/\.stat-card\s*\{/, `.stat-card {\n  flex: 1 0 200px;`); // make sure it flexes properly

fs.writeFileSync('style.css', css);
console.log('Fixed single line layout and removed earnings');
