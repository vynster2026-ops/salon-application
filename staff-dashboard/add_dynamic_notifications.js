const fs = require('fs');

let appJs = fs.readFileSync('app.js', 'utf8');

const replacement = `function populateNotifications() {
  const panel = document.getElementById("notifPanel");
  if (!panel) return;
  const body = panel.querySelector(".notif-body");
  if (!body) return;

  const s = STAFF_DATA[currentStaff];
  if (!s) return;

  let html = "";
  let notifCount = 0;

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  
  if (s.appointments) {
    s.appointments.forEach(apt => {
      if (apt.status === "upcoming" || apt.status === "in-progress") {
        const [h, m] = apt.time.split(":").map(Number);
        const aptMins = h * 60 + m;
        // If it's upcoming in the next 3 hours
        if (aptMins >= nowMins && aptMins <= nowMins + 180) {
          const diff = aptMins - nowMins;
          let timeText = diff <= 0 ? "now" : \`in \${diff} mins\`;
          html += \`
            <div class="notif-item">
              <span class="notif-icon warning">📅</span>
              <div>
                <strong>Next Client</strong><br />\${apt.client} is arriving \${timeText}.
              </div>
            </div>\`;
          notifCount++;
        }
      }
    });
  }

  if (s.reviews) {
    s.reviews.forEach(rev => {
      if (rev.date === "Today") {
        html += \`
          <div class="notif-item">
            <span class="notif-icon primary">⭐</span>
            <div>
              <strong>New Review</strong><br />\${rev.client} left you a \${rev.rating}-star review!
            </div>
          </div>\`;
        notifCount++;
      }
    });
  }

  if (s.leaves) {
    s.leaves.forEach(l => {
      if (l.status === "approved" || l.status === "pending") {
        const icon = l.status === "approved" ? "✅" : "⏳";
        const iconClass = l.status === "approved" ? "success" : "warning";
        html += \`
          <div class="notif-item">
            <span class="notif-icon \${iconClass}">\${icon}</span>
            <div>
              <strong>Leave \${l.status.charAt(0).toUpperCase() + l.status.slice(1)}</strong><br />Your leave from \${l.from} is \${l.status}.
            </div>
          </div>\`;
        notifCount++;
      }
    });
  }

  if (notifCount === 0) {
    html = \`<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">No new notifications</div>\`;
  }

  body.innerHTML = html;
  
  const badge = document.querySelector(".notif-dot");
  if (badge) {
    if (notifCount > 0) {
      badge.style.display = "block";
    } else {
      badge.style.display = "none";
    }
  }
}

function toggleNotifPanel() {
  populateNotifications();
  const panel = document.getElementById("notifPanel");
  panel.classList.toggle("hidden");
}`;

appJs = appJs.replace(/function toggleNotifPanel\(\) {[\s\S]*?panel\.classList\.toggle\("hidden"\);\n}/, replacement);

// Also populate on load so the dot shows correctly
appJs = appJs.replace(/updateLiveClock\(\);\n\n  setInterval/m, "updateLiveClock();\n\n  populateNotifications();\n\n  setInterval");

fs.writeFileSync('app.js', appJs);
console.log("Added dynamic notifications");
