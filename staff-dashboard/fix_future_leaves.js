const fs = require('fs');
let styleContent = fs.readFileSync('style.css', 'utf8');

if (!styleContent.includes('.cal-cell.planned-leave')) {
  const cssToAdd = `
.cal-cell.planned-leave {
  background: #e2e8f0;
  color: #64748b;
  border: 1px dashed #94a3b8;
}
body.dark .cal-cell.planned-leave {
  background: rgba(255,255,255,0.1);
  color: #cbd5e1;
  border: 1px dashed #64748b;
}
.att-dot.planned-leave {
  background: #cbd5e1;
  border: 1px dashed #94a3b8;
}
`;
  styleContent = styleContent.replace('.cal-cell.future {', cssToAdd + '\n.cal-cell.future {');
  fs.writeFileSync('style.css', styleContent);
}

let appContent = fs.readFileSync('app.js', 'utf8');
const oldAppLogic = `    if (isHoliday) {
      cls = "holiday";
    } else if (dow === 4) {
      // Thursday is designated as the weekly off day (exception from weekends Friday, Saturday, Sunday)
      cls = "weekly-off";
    } else if (isAppliedLeave) {
      cls = "absent non-peak"; // Mark applied leaves
    } else if (isFutureMonth || (isCurrentMonth && d > currentDay)) {
      cls = "future";
    } else {`;

const newAppLogic = `    const isFuture = isFutureMonth || (isCurrentMonth && d > currentDay);

    if (isHoliday) {
      cls = "holiday";
    } else if (dow === 4) {
      // Thursday is designated as the weekly off day
      cls = "weekly-off";
    } else if (isFuture) {
      if (isAppliedLeave) {
        cls = "planned-leave"; // Future applied leaves are planned
      } else {
        cls = "future";
      }
    } else if (isAppliedLeave) {
      cls = "absent non-peak"; // Past applied leaves are absent
    } else {`;

if (appContent.includes('cls = "absent non-peak"; // Mark applied leaves')) {
  appContent = appContent.replace(oldAppLogic, newAppLogic);
  fs.writeFileSync('app.js', appContent);
}

let htmlContent = fs.readFileSync('attendance.html', 'utf8');
const oldLegend = `<div style="display: flex; align-items: center; gap: 6px;"><span class="att-dot weekly-off"></span> Weekly Off</div>`;
const newLegend = `<div style="display: flex; align-items: center; gap: 6px;"><span class="att-dot weekly-off"></span> Weekly Off</div>
              <div style="display: flex; align-items: center; gap: 6px;"><span class="att-dot planned-leave"></span> Planned Leave</div>`;
if (!htmlContent.includes('Planned Leave')) {
  htmlContent = htmlContent.replace(oldLegend, newLegend);
  fs.writeFileSync('attendance.html', htmlContent);
}
console.log("Updated future applied leaves to show as planned-leave");
