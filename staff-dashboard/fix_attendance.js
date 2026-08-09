const fs = require('fs');
let content = fs.readFileSync('attendance.html', 'utf8');

const regex = /<!-- MAIN GRID -->[\s\S]*?<div class="cal-days-header">/;
const replacement = `<!-- MAIN GRID -->
      <div class="main-grid">
        <!-- LEFT COLUMN -->
        <div class="left-col">
          <!-- ATTENDANCE CALENDAR -->
          <div class="card">
            <div class="card-head">
              <div style="flex: 1;">
                <div class="card-title">Attendance History</div>
                <div class="card-sub">Select month and year to view records</div>
              </div>
              <div style="display: flex; gap: 8px;">
                <select id="calMonth" class="btn-action" style="padding: 4px 8px; font-size: 13px;" onchange="renderFullCalendar()">
                  <option value="0">January</option>
                  <option value="1">February</option>
                  <option value="2">March</option>
                  <option value="3">April</option>
                  <option value="4">May</option>
                  <option value="5" selected="">June</option>
                  <option value="6">July</option>
                  <option value="7">August</option>
                  <option value="8">September</option>
                  <option value="9">October</option>
                  <option value="10">November</option>
                  <option value="11">December</option>
                </select>
                <select id="calYear" class="btn-action" style="padding: 4px 8px; font-size: 13px;" onchange="renderFullCalendar()">
                  <option value="2020">2020</option>
                  <option value="2021">2021</option>
                  <option value="2022">2022</option>
                  <option value="2023">2023</option>
                  <option value="2024">2024</option>
                  <option value="2025">2025</option>
                  <option value="2026" selected="">2026</option>
                </select>
              </div>
            </div>
            <div style="padding: 10px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 15px; background: var(--muted-bg); font-size: 12px;">
              <div style="display: flex; align-items: center; gap: 6px;"><span class="att-dot present"></span> Present</div>
              <div style="display: flex; align-items: center; gap: 6px;"><span class="att-dot late"></span> Late</div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="att-dot absent" style="background: #8E24AA;"></span>
                <span class="att-dot absent" style="background: #CE93D8; margin-left: -3px; margin-right: 3px;"></span>
                Absent (Peak / Normal)
              </div>
              <div style="display: flex; align-items: center; gap: 6px;"><span class="att-dot holiday"></span> Govt Holiday</div>
              <div style="display: flex; align-items: center; gap: 6px;"><span class="att-dot permission"></span> Permission</div>
              <div style="display: flex; align-items: center; gap: 6px;"><span class="att-dot weekly-off"></span> Weekly Off</div>
            </div>
            <div class="cal-days-header">`;

content = content.replace(regex, replacement);
fs.writeFileSync('attendance.html', content);
console.log('Fixed attendance.html using regex successfully');
