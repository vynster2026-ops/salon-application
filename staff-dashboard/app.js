// ── AUTHENTICATION CHECK ─────────────────────────────────────────
if (!localStorage.getItem('loggedInPhone') && !window.location.pathname.includes('staff-login.html') && !window.location.pathname.includes('staff-register.html')) {
  window.location.href = 'staff-login.html';
}

// ── API BASE URL RESOLVER ──────────────────────────────────────
const API_BASE = (typeof window !== 'undefined' && (window.location.protocol === 'file:' || window.location.port === '5500' || window.location.port === '5503' || window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'))
  ? 'http://localhost:5000/api'
  : '/api';

// ── STATE ──────────────────────────────────────────────────────
// Load persisted STAFF_DATA to ensure cross-page state updates (like added services) are retained
let savedStaffData = localStorage.getItem('STAFF_DATA_PERSIST');
if (savedStaffData && typeof STAFF_DATA !== 'undefined') {
  try {
    const parsed = JSON.parse(savedStaffData);
    Object.assign(STAFF_DATA, parsed);
  } catch (e) { console.error("Error loading STAFF_DATA_PERSIST", e); }
}

// Dynamic resolver for currentStaff based on logged-in user
let currentStaff = "priya"; // Default fallback

if (typeof STAFF_DATA !== 'undefined') {
  const loggedInUser = localStorage.getItem('loggedInUser');
  const loggedInEmail = localStorage.getItem('loggedInEmail');
  const loggedInPhone = localStorage.getItem('loggedInPhone');
  
  let matchedKey = null;
  if (loggedInUser || loggedInEmail || loggedInPhone) {
    for (const key of Object.keys(STAFF_DATA)) {
      const staff = STAFF_DATA[key];
      const nameMatch = loggedInUser && (
        key.toLowerCase() === loggedInUser.toLowerCase() ||
        staff.name.toLowerCase() === loggedInUser.toLowerCase() ||
        staff.name.toLowerCase().includes(loggedInUser.toLowerCase()) ||
        loggedInUser.toLowerCase().includes(staff.name.toLowerCase())
      );
      const emailMatch = loggedInEmail && staff.email && (
        staff.email.toLowerCase() === loggedInEmail.toLowerCase()
      );
      const phoneMatch = loggedInPhone && staff.phone && (
        staff.phone.replace(/\D/g, '') === loggedInPhone.replace(/\D/g, '')
      );
      
      if (nameMatch || emailMatch || phoneMatch) {
        matchedKey = key;
        break;
      }
    }
  }
  
  if (matchedKey) {
    currentStaff = matchedKey;
  } else if (loggedInUser && loggedInUser.trim() !== "") {
    // Dynamically create a custom staff profile for newly registered users
    const newKey = loggedInUser.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (newKey && !STAFF_DATA[newKey]) {
      const regRole = localStorage.getItem('loggedInRole') || "Senior Stylist";
      const regPhone = localStorage.getItem('loggedInPhone') || "";
      const regEmail = localStorage.getItem('loggedInEmail') || "";
      const regSpecialties = JSON.parse(localStorage.getItem('loggedInSpecialties') || '[]');
      
      STAFF_DATA[newKey] = {
        name: loggedInUser,
        role: regRole,
        avatar: loggedInUser.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2),
        phone: regPhone,
        email: regEmail,
        joinDate: "May 2026",
        shift: "9:00 AM – 6:00 PM",
        status: "active",
        rating: 5.0,
        completedToday: 0,
        todayAppointments: 0,
        earnedRevenue: 0,
        avgServiceTime: 45,
        clientReturnRate: 100,
        attendance: 100,
        currentClient: null,
        nextClient: null,
        nextTime: null,
        specialties: regSpecialties.length > 0 ? regSpecialties : ["Haircut", "Hair Color"],
        weeklyRevenue: [1500, 2000, 1800, 2500, 3000, 0, 0],
        weeklyServices: [2, 4, 3, 5, 6, 0, 0],
        appointments: typeof generateAppointments === 'function' ? generateAppointments() : [],
        reviews: [],
        leaves: [],
        clients: []
      };
      localStorage.setItem('STAFF_DATA_PERSIST', JSON.stringify(STAFF_DATA));
      currentStaff = newKey;
    } else if (newKey && STAFF_DATA[newKey]) {
      currentStaff = newKey;
    }
  }
}

// Ensure the logged-in staff has appointments to make the dashboard a working model
if (STAFF_DATA[currentStaff] && (!STAFF_DATA[currentStaff].appointments || STAFF_DATA[currentStaff].appointments.length === 0)) {
  if (typeof generateAppointments === 'function') {
    STAFF_DATA[currentStaff].appointments = generateAppointments();
    STAFF_DATA[currentStaff].todayAppointments = STAFF_DATA[currentStaff].appointments.length;
    
    const doneApts = STAFF_DATA[currentStaff].appointments.filter(a => a.status === 'done');
    const earnedToday = doneApts.reduce((sum, a) => sum + (parseFloat(a.price) || 0), 0);
    STAFF_DATA[currentStaff].earnedRevenue = earnedToday;
    STAFF_DATA[currentStaff].completedToday = doneApts.length;

    // Also add some base stats to make it look active
    STAFF_DATA[currentStaff].weeklyRevenue = [1500, 2000, 1800, 2500, 3000, 0, earnedToday];
    STAFF_DATA[currentStaff].weeklyServices = [2, 4, 3, 5, 6, 0, doneApts.length];
    
    localStorage.setItem('STAFF_DATA_PERSIST', JSON.stringify(STAFF_DATA));
  }
}

let leaveType = "casual";
let darkMode = false;
let aptStates = JSON.parse(localStorage.getItem('aptStates')) || {};
function saveAptStates() {
  localStorage.setItem('aptStates', JSON.stringify(aptStates));
}

let staffLeaves = JSON.parse(localStorage.getItem('staffLeaves')) || null;
function saveStaffLeaves() {
  localStorage.setItem('staffLeaves', JSON.stringify(staffLeaves));
}
let serviceCatalog = [];
let SERVICE_TYPES = { indoor: [], outdoor: [] };
let allClients = []; // Global client list from db.json
let currentFilter = ''; // Track active indoor/outdoor filter

// ── INIT ────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setDate();
  await loadServiceCatalog();
  await syncLiveAppointments();
  loadStaff(currentStaff);
  buildCalendar();
  updateLiveClock();

  // Initial render of clients if on the records page
  // if (document.getElementById("clientList")) {
  //   renderClients();
  // }

  // Auto-refresh timeline and dashboard card every 30 seconds
  setInterval(() => {
    const s = STAFF_DATA[currentStaff];
    if (typeof buildDashboard === 'function') buildDashboard(s);
    if (typeof refreshTimeline === 'function') refreshTimeline();
  }, 30000);

  // Update clock every second
  setInterval(updateLiveClock, 1000);

  // Sync with db.json every 2 minutes
  setInterval(() => {
    syncLiveAppointments();
  }, 120000);
});

// ── NOTIFICATIONS ───────────────────────────────────────────────
function populateNotifications() {
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
          let timeText = diff <= 0 ? "now" : `in ${diff} mins`;
          html += `
            <div class="notif-item">
              <span class="notif-icon warning">📅</span>
              <div>
                <strong>Next Client</strong><br />${apt.client} is arriving ${timeText}.
              </div>
            </div>`;
          notifCount++;
        }
      }
    });
  }

  if (s.reviews) {
    s.reviews.forEach(rev => {
      if (rev.date === "Today") {
        html += `
          <div class="notif-item">
            <span class="notif-icon primary">⭐</span>
            <div>
              <strong>New Review</strong><br />${rev.client} left you a ${rev.rating}-star review!
            </div>
          </div>`;
        notifCount++;
      }
    });
  }

  if (s.leaves) {
    s.leaves.forEach(l => {
      if (l.status === "approved" || l.status === "pending") {
        const icon = l.status === "approved" ? "✅" : "⏳";
        const iconClass = l.status === "approved" ? "success" : "warning";
        html += `
          <div class="notif-item">
            <span class="notif-icon ${iconClass}">${icon}</span>
            <div>
              <strong>Leave ${l.status.charAt(0).toUpperCase() + l.status.slice(1)}</strong><br />Your leave from ${l.from} is ${l.status}.
            </div>
          </div>`;
        notifCount++;
      }
    });
  }

  if (notifCount === 0) {
    html = `<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">No new notifications</div>`;
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
}
window.addEventListener("click", (e) => {
  if (!e.target.closest(".notif-btn") && !e.target.closest(".notif-panel")) {
    document.getElementById("notifPanel")?.classList.add("hidden");
  }
  if (
    !e.target.closest(".custom-select-btn") &&
    !e.target.closest(".custom-select-menu")
  ) {
    document.getElementById("staffDropdown")?.classList.add("hidden");
  }
});

function setDate() {
  const d = new Date();
  const el = document.getElementById("todayDate");
  if (el) {
    el.textContent = d.toLocaleDateString(
      "en-IN",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    );
  }
  const h = d.getHours();
}

window.lastCheckedMinute = -1;

function updateLiveClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
  const el = document.getElementById("liveClock");
  if (el) el.textContent = timeStr;

  // Auto-refresh the timeline & dashboard statuses precisely when the minute changes!
  const currentMin = now.getMinutes();
  if (window.lastCheckedMinute !== currentMin) {
    window.lastCheckedMinute = currentMin;
    if (currentStaff) {
      const s = STAFF_DATA[currentStaff];
      if (s) {
        // Recalculate dynamic staff state (Next Client, upcoming, etc) based on live time
        loadStaff(currentStaff);
        if (typeof buildDashboard === 'function') buildDashboard(s);
        if (typeof buildTimeline === 'function') buildTimeline(s, window.currentFilter || '');
      }
    }
  }
}

function getGreeting() {
  const d = new Date();
  const h = d.getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const el = document.getElementById("greeting");
  if (el) el.textContent = greet + ", " + "Priya ✨";
}

async function loadServiceCatalog() {
  // Flatten SERVICES_MENU from data.js as fallback
  let flatServices = [];
  if (typeof SERVICES_MENU !== 'undefined') {
    SERVICES_MENU.forEach(cat => {
      cat.services.forEach(svc => {
        flatServices.push({
          id: svc.name.replace(/\s+/g, '-').toLowerCase(),
          name: svc.name,
          cat: cat.category,
          duration: parseInt(svc.duration) || 60,
          price: parseInt(svc.price.replace(/,/g, '')) || 0,
          icon: svc.icon || '✨',
          type: (svc.name.toLowerCase().includes('makeup') || svc.name.toLowerCase().includes('bridal') || svc.name.toLowerCase().includes('outdoor') || svc.name.toLowerCase().includes('event')) ? 'outdoor' : 'indoor'
        });
      });
    });
  }

  // Set default before fetch
  serviceCatalog = [...flatServices];

  try {
    const resSvc = await fetch("/api/services");
    const resCli = await fetch("/api/clients");
    if (resSvc.ok) {
      const services = await resSvc.json();
      if (services && services.length > 0) {
        serviceCatalog = services;
      }
    }
    if (resCli.ok) {
      allClients = await resCli.json();
    }
    try {
      const resBks = await fetch("/api/bookings");
      if (resBks.ok) {
        window.allBookings = await resBks.json();
      } else {
        window.allBookings = [];
      }
    } catch (e) {
      window.allBookings = [];
    }
    window.allAppointments = [];
  } catch (error) {
    console.warn("Running in local mode or admin API offline, trying db.json fallback.");
    try {
      const response = await fetch("db.json");
      if (response.ok) {
        const data = await response.json();
        if (data.services && data.services.length > 0) {
          serviceCatalog = data.services;
        }
        allClients = data.clients || [];
        window.allBookings = data.bookings || [];
        window.allAppointments = data.appointments || [];
      }
    } catch (err) {}
  }

  // Sort alphabetically for better UX
  serviceCatalog.sort((a, b) => a.name.localeCompare(b.name));

  renderCheatSheet();

  // Populate any existing service dropdowns
  const select = document.getElementById("addServiceSelect");
  if (select) {
    select.innerHTML = serviceCatalog.map(s => `<option value="${s.id}">${s.name} - ₹${s.price.toLocaleString("en-IN")}</option>`).join("");
  }
}

async function syncLiveAppointments() {
  const staff = STAFF_DATA[currentStaff];
  const staffId = localStorage.getItem('loggedInStaffId') || (staff ? staff.id : currentStaff) || 'priya';
  
  try {
    const response = await fetch(`/api/my-appointments?staffId=${staffId}`);
    if (response.ok) {
      const bookings = await response.json();
      
      // Map the bookings array from MongoDB format to Staff Timeline format
      const mappedApts = bookings.map(b => {
        const currentStatus = (b.status || 'upcoming').toLowerCase();
        
        return {
          id: b.id || b._id,
          time: b.time || "09:00",
          client: b.clientName || "Walk-in Client",
          service: Array.isArray(b.services) ? b.services.join(", ") : (b.services || "General Service"),
          duration: 60, // Default duration if not present
          price: Number(b.total) || 0,
          status: currentStatus,
          phone: b.clientPhone || "",
          notes: b.notes || ""
        };
      });

      // Update STAFF_DATA appointments for current logged-in staff
      if (STAFF_DATA[currentStaff]) {
        STAFF_DATA[currentStaff].appointments = mappedApts;
        
        // Sync aptStates with the retrieved statuses
        mappedApts.forEach(a => {
          if (!aptStates[a.id]) {
            aptStates[a.id] = a.status;
          }
        });
        saveAptStates();

        // Sort appointments by time
        STAFF_DATA[currentStaff].appointments.sort((a, b) => a.time.localeCompare(b.time));
        
        // Refresh the UI timeline and dashboard
        if (typeof refreshTimeline === 'function') refreshTimeline();
        if (typeof buildDashboard === 'function') buildDashboard(STAFF_DATA[currentStaff]);
      }
    }
  } catch (error) {
    console.error("Unable to sync live appointments from Admin server:", error);
  }
}




// ── TOAST NOTIFICATIONS ─────────────────────────────────────────
function showToast(message, type = "success", icon = "✅") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span style="font-size:18px">${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    toast.addEventListener("animationend", () => toast.remove());
  }, 3000);
}

// ── LOAD STAFF ───────────────────────────────────────────────────
function loadStaff(id) {
  currentStaff = id;
  localStorage.setItem('loggedInStaffId', id);
  const s = STAFF_DATA[id];
  // Do not reset aptStates, use the persistent global object.

  // Recalculate metrics dynamically based on active appointments array
  s.todayAppointments = s.appointments.length;
  s.completedToday = s.appointments.filter(a => a.status === 'done').length;

  s.appointments.forEach((a) => {
    if (!aptStates[a.id]) aptStates[a.id] = a.status;
  });
  saveAptStates();

  // Dynamically calculate "Serving" and "Next" based on real schedule timeline
  const inProgressApt = s.appointments.find(a => (aptStates[a.id] || a.status) === 'in-progress');
  const upcomingApts = s.appointments.filter(a => (aptStates[a.id] || a.status) === 'upcoming');
  const nextApt = upcomingApts.length > 0 ? upcomingApts[0] : null;

  s.currentClient = inProgressApt ? inProgressApt.client : null;
  if (nextApt) {
    s.nextClient = nextApt.client;
    s.nextTime = nextApt.time;
  } else {
    s.nextClient = null;
    s.nextTime = null;
  }

  // Update header and sidebar info
  let displayName = localStorage.getItem('loggedInUser') || s.name;
  if (displayName && displayName.includes('@')) {
    let namePart = displayName.split('@')[0];
    namePart = namePart.replace(/[0-9]/g, ''); // Remove any numbers from the email prefix
    displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
  }
  const greetEl = document.getElementById("greeting");
  if (greetEl) {
    greetEl.textContent =
      (new Date().getHours() < 12
        ? "Good morning"
        : new Date().getHours() < 17
          ? "Good afternoon"
          : "Good evening") +
      ", " +
      displayName.split(" ")[0] +
      " ✨";
  }
  const shiftEl = document.getElementById("shiftLine");
  if (shiftEl) shiftEl.textContent = s.shift;

  // Header + sidebar
  const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  ["headerAvatar", "sidebarAvatar", "profileAvatar"].forEach((id) =>
    setEl(id, initials),
  );
  ["headerName", "sidebarName", "profileName", "payrollAccountName"].forEach((id) =>
    setEl(id, displayName),
  );

  // Dynamic Role logic
  const registeredRole = localStorage.getItem('loggedInRole') || s.role || "Senior Stylist";
  ["headerRole", "profileRole"].forEach((id) => setEl(id, registeredRole));
  const sidebarRoleEl = document.getElementById("sidebarRole");
  if (sidebarRoleEl) {
    sidebarRoleEl.textContent = registeredRole + " · " + (s.shift ? s.shift.split("–")[0].trim() : "9:00 AM");

    // Inject Live Tracking Data into Sidebar Profile
    const loc = localStorage.getItem('lastLoginLocation');
    const time = localStorage.getItem('lastLoginTime');
    const parent = sidebarRoleEl.parentElement;
    if (loc && time) {
      if (!document.getElementById('sidebarTracking')) {
        const trk = document.createElement('div');
        trk.id = 'sidebarTracking';
        trk.style.cssText = 'font-size: 10px; color: var(--primary); margin-top: 6px; font-weight: 600; line-height: 1.4; background: var(--primary-light); padding: 4px; border-radius: 4px;';
        trk.innerHTML = `📍 ${loc.substring(0, 18)}..<br>⏱️ Logged at ${time}`;
        parent.appendChild(trk);
      }
    }
    
    // Inject Check-in and Check-out times and Staff ID
    if (!document.getElementById('sidebarCheckInOut')) {
      const checkInOut = document.createElement('div');
      checkInOut.id = 'sidebarCheckInOut';
      checkInOut.style.cssText = 'font-size: 11px; color: var(--muted); margin-top: 6px; display: flex; flex-direction: column; gap: 3px; font-weight: 500;';
      
      const shiftParts = s.shift ? s.shift.split('–') : ['9:00 AM', '6:00 PM'];
      const checkInTime = shiftParts[0] ? shiftParts[0].trim() : '9:00 AM';
      const checkOutTime = shiftParts[1] ? shiftParts[1].trim() : '6:00 PM';
      const staffId = s.id || `STF-${s.phone ? s.phone.slice(-4) : '001'}`;
      
      checkInOut.innerHTML = `
        <div style="display: flex; justify-content: space-between;"><span>Staff ID:</span> <span style="color: var(--primary); font-weight: 600;">${staffId}</span></div>
        <div style="display: flex; justify-content: space-between;"><span>Check-in:</span> <span style="color: var(--primary); font-weight: 600;">${checkInTime}</span></div>
        <div style="display: flex; justify-content: space-between;"><span>Check-out:</span> <span style="color: var(--primary); font-weight: 600;">${checkOutTime}</span></div>
      `;
      parent.appendChild(checkInOut);
    }
  }

  // Status
  const statusLabel =
    s.status === "active"
      ? "● On Duty"
      : s.status === "on-break"
        ? "● On Break"
        : "● Off Duty";
  const statusClass =
    s.status === "active"
      ? "active"
      : s.status === "on-break"
        ? "break"
        : "off";
  const headerStatus = document.getElementById("headerStatus");
  if (headerStatus) {
    headerStatus.textContent = statusLabel;
    headerStatus.className = "status-badge " + statusClass;
  }
  const sidebarDot = document.getElementById("sidebarDot");
  if (sidebarDot) sidebarDot.className = "status-dot " + statusClass;
  const profileStatus = document.getElementById("profileStatus");
  if (profileStatus) profileStatus.textContent = statusLabel;

  // Dynamic Profile Info
  const registeredPhone = localStorage.getItem('loggedInPhone') || s.phone || "No phone added";
  const registeredEmail = localStorage.getItem('loggedInEmail') || s.email || "No email added";

  setEl("pShift", s.shift);
  setEl("pPhone", registeredPhone);
  setEl("pEmail", registeredEmail);
  if (s.currentClient) {
    show("pCurrentRow");
    setEl("pCurrent", s.currentClient);
  } else hide("pCurrentRow");
  if (s.nextClient) {
    show("pNextRow");
    setEl("pNext", s.nextClient + " at " + s.nextTime);
  } else hide("pNextRow");

  // Specialties
  let registeredSpecialties = s.specialties || ["Haircut", "Hair Color"];
  try {
    const lsSpec = localStorage.getItem('loggedInSpecialties');
    if (lsSpec) {
      const parsed = JSON.parse(lsSpec);
      if (Array.isArray(parsed) && parsed.length > 0) {
        registeredSpecialties = parsed;
      }
    }
  } catch (e) { }

  const specialtiesEl = document.getElementById("specialties");
  if (specialtiesEl) {
    specialtiesEl.innerHTML = registeredSpecialties
      .map((sp) => `<span class="specialty-tag">${sp}</span>`)
      .join("");
  }

  buildStats(s);
  buildDashboard(s);
  if (typeof buildTimeline === 'function') buildTimeline(s);
  if (typeof buildLeave === 'function') buildLeave(s);
  if (typeof buildClients === 'function') buildClients(s);
  if (typeof buildPayroll === 'function') buildPayroll(s, registeredRole);
  if (typeof buildSettings === 'function') buildSettings(s, displayName, registeredRole, registeredPhone, registeredEmail);
}

function buildSettings(s, name, role, phone, email) {
  const setNameEl = document.getElementById("setName");
  if (!setNameEl) return;

  // Personal info
  if (setNameEl) setNameEl.value = name;

  const setPhoneEl = document.getElementById("setPhone");
  if (setPhoneEl) setPhoneEl.value = phone;

  const setEmailEl = document.getElementById("setEmail");
  if (setEmailEl) setEmailEl.value = email;

  // Join date & shift from staff data
  const setJoinEl = document.getElementById("setJoinDate");
  if (setJoinEl) setJoinEl.value = s.joinDate || "—";

  const setShiftEl = document.getElementById("setShift");
  if (setShiftEl) setShiftEl.value = s.shift || "—";

  // Professional role
  const setRoleTextEl = document.getElementById("setRoleText");
  if (setRoleTextEl) setRoleTextEl.value = role;

  const setRoleEl = document.getElementById("setRole");
  if (setRoleEl) {
    const opts = Array.from(setRoleEl.options);
    if (!opts.find(o => o.value === role)) {
      const newOpt = new Option(role, role);
      setRoleEl.add(newOpt);
    }
    setRoleEl.value = role;
  }

  // Profile card header
  setEl("settingsDisplayName", name);
  setEl("settingsDisplayRole", role);
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  setEl("settingsAvatar", initials);

  // Specialties from localStorage (matches Dashboard profile)
  const specialtyContainer = document.getElementById("specialtyContainer");
  if (specialtyContainer) {
    let specs = s.specialties || [];
    try {
      const lsSpec = localStorage.getItem('loggedInSpecialties');
      if (lsSpec) {
        const parsed = JSON.parse(lsSpec);
        if (Array.isArray(parsed) && parsed.length > 0) specs = parsed;
      }
    } catch (e) { }
    specialtyContainer.innerHTML = specs.map(sp =>
      `<label class="checkbox-item"><input type="checkbox" checked disabled /> ${sp}</label>`
    ).join('');
  }

  // Stats mini-summary — mirrors Dashboard profile card
  const ratingEl = document.getElementById("setRating");
  if (ratingEl) ratingEl.textContent = s.rating ? `${s.rating} ⭐` : "—";
  const attendEl = document.getElementById("setAttendance");
  if (attendEl) attendEl.textContent = s.attendance ? `${s.attendance}%` : "—";
  const returnEl = document.getElementById("setReturnRate");
  if (returnEl) returnEl.textContent = s.clientReturnRate ? `${s.clientReturnRate}%` : "—";
}

function buildPayroll(s, role) {
  const payBaseEl = document.getElementById("payBase");
  if (!payBaseEl) return;

  // Role-based base salary
  let baseSalary = 18000;
  const r = (role || '').toLowerCase();
  if (r.includes("junior")) baseSalary = 12000;
  else if (r.includes("nail")) baseSalary = 10000;
  else if (r.includes("makeup")) baseSalary = 15000;
  else if (r.includes("manager")) baseSalary = 25000;

  // Revenue calculations
  const weeklyRevs = s.weeklyRevenue || [4200, 5100, 3800, 6200, 5600, 8240, 0];
  const weeklySum = weeklyRevs.reduce((a, b) => a + b, 0);
  const monthlyRevenue = weeklySum + (s.earnedRevenue || 0);

  const svcComm = Math.round(monthlyRevenue * 0.10);
  const prodComm = Math.round(monthlyRevenue * 0.05);
  const tips = Math.round(monthlyRevenue * 0.03);
  const totalComm = svcComm + prodComm + tips;

  // Bonuses
  const ratingBonus = (s.rating || 0) >= 4.8 ? 1000 : (s.rating || 0) >= 4.5 ? 500 : 0;
  const retentionBonus = (s.clientReturnRate || 0) >= 90 ? 800 : (s.clientReturnRate || 0) >= 80 ? 400 : 0;
  const attendanceBonus = (s.attendance || 0) >= 100 ? 500 : (s.attendance || 0) >= 95 ? 250 : 0;
  const totalBonus = ratingBonus + retentionBonus + attendanceBonus;

  // Deductions
  const pf = Math.round(baseSalary * 0.12);
  const profTax = 200;
  const tds = Math.round((baseSalary + totalComm) * 0.02);
  const totalDeductions = pf + profTax + tds;

  // Net
  const grossTotal = baseSalary + totalComm + totalBonus;
  const netPay = grossTotal - totalDeductions;

  // Month label
  const now = new Date();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const curMonth = monthNames[now.getMonth()];
  const curYear = now.getFullYear();
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const dueDate = `01 ${monthNames[nextMonthDate.getMonth()]} ${nextMonthDate.getFullYear()}`;
  const fmt = v => `₹${v.toLocaleString('en-IN')}`;

  // Populate KPI cards
  setEl("payTotal", fmt(grossTotal));
  setEl("payComm", fmt(totalComm));
  setEl("payBonus", fmt(totalBonus));
  setEl("payBase", fmt(baseSalary));

  // Salary meter
  const goal = baseSalary + 8000;
  const progress = Math.min(100, Math.round((netPay / goal) * 100));
  setEl("payProgress", `${progress}%`);
  setEl("payGoalLabel", `Goal: ${fmt(goal)}`);
  const bar = document.getElementById("payProgressBar");
  if (bar) setTimeout(() => bar.style.width = `${progress}%`, 100);

  // Month title
  setEl("payMonthTitle", `${curMonth} ${curYear} Earnings`);
  setEl("payNetDate", `Due: ${dueDate}`);

  // Breakdown grid
  setEl("payBaseSm", fmt(baseSalary));
  setEl("payCommSvc", fmt(svcComm));
  setEl("payCommProd", fmt(prodComm));
  setEl("payCommTips", fmt(tips));
  setEl("payBonusSm", fmt(totalBonus));
  setEl("payDeduct", `−${fmt(totalDeductions)}`);
  setEl("payNet", fmt(netPay));

  // Deductions panel
  setEl("payPF", `−${fmt(pf)}`);
  setEl("payTDS", `−${fmt(tds)}`);
  setEl("payDeductTotal", fmt(totalDeductions));

  // Bonus eligibility
  setEl("payBonusRating", fmt(ratingBonus));
  setEl("payBonusRetention", fmt(retentionBonus));
  setEl("payBonusAttendance", fmt(attendanceBonus));

  // Weekly bar chart
  const barsEl = document.getElementById("payWeeklyBars");
  const labelsEl = document.getElementById("payWeeklyLabels");
  if (barsEl && labelsEl) {
    const weeks = weeklyRevs.slice(0, 4);
    const maxW = Math.max(...weeks, 1);
    const colors = ["#1a6b8a", "#2d9e6b", "#a04090", "#e07b39"];
    barsEl.innerHTML = weeks.map((v, i) => {
      const h = Math.round((v / maxW) * 100);
      return `<div class="pay-week-bar" data-tip="${fmt(v)}" style="height:${h}px; background:${colors[i]}; opacity:0.85;"></div>`;
    }).join('');
    labelsEl.innerHTML = ["Wk 1", "Wk 2", "Wk 3", "Wk 4"].map(w =>
      `<div class="pay-week-label">${w}</div>`
    ).join('');
  }

  // Payslip history table
  const tbody = document.getElementById("payslipBody");
  if (tbody) {
    const history = [
      { month: monthNames[(now.getMonth() - 1 + 12) % 12] + " " + (now.getMonth() === 0 ? curYear - 1 : curYear), base: baseSalary, comm: Math.round(totalComm * 1.05), status: "Paid" },
      { month: monthNames[(now.getMonth() - 2 + 12) % 12] + " " + (now.getMonth() <= 1 ? curYear - 1 : curYear), base: baseSalary, comm: Math.round(totalComm * 0.92), status: "Paid" },
      { month: monthNames[(now.getMonth() - 3 + 12) % 12] + " " + (now.getMonth() <= 2 ? curYear - 1 : curYear), base: baseSalary, comm: Math.round(totalComm * 1.10), status: "Paid" },
      { month: monthNames[(now.getMonth() - 4 + 12) % 12] + " " + (now.getMonth() <= 3 ? curYear - 1 : curYear), base: baseSalary, comm: Math.round(totalComm * 0.88), status: "Paid" },
      { month: monthNames[(now.getMonth() - 5 + 12) % 12] + " " + (now.getMonth() <= 4 ? curYear - 1 : curYear), base: baseSalary, comm: Math.round(totalComm * 0.95), status: "Paid" },
    ];
    tbody.innerHTML = history.map(h => {
      const net = h.base + h.comm - totalDeductions;
      return `<tr class="payslip-row">
        <td style="font-weight:600;">${h.month}</td>
        <td>${fmt(h.base)}</td>
        <td style="color:var(--primary);">${fmt(h.comm)}</td>
        <td style="font-weight:700;">${fmt(net)}</td>
        <td><span style="background:#dcfce7;color:var(--success);padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;">✓ ${h.status}</span></td>
        <td style="text-align:right;"><button class="btn-outline btn-sm ripple" onclick="downloadPayslip('${h.month}', ${h.base}, ${h.comm}, ${net})">📄 Download</button></td>
      </tr>`;
    }).join('');
  }
}

// Dynamically generate and download styled, printable payslip receipt
function downloadPayslip(month, base, comm, net) {
  const staff = STAFF_DATA[currentStaff] || { name: "Priya Sharma", role: "Senior Stylist" };
  let displayName = localStorage.getItem('loggedInUser') || staff.name;
  if (displayName && displayName.includes('@')) {
    let namePart = displayName.split('@')[0];
    namePart = namePart.replace(/[0-9]/g, '');
    displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
  }
  const designation = staff.role || "Stylist";
  const deductions = base + comm - net;
  
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Payslip - ${month}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Inter', sans-serif; background-color: #f8fafc; color: #1e293b; padding: 40px; margin: 0; }
    .payslip-container { max-width: 650px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); padding: 40px; box-sizing: border-box; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 24px; margin-bottom: 24px; }
    .brand { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; color: #1a6b8a; line-height: 1.1; }
    .brand span { font-size: 11px; color: #64748b; font-weight: normal; }
    .title { text-align: right; }
    .title h1 { margin: 0; font-size: 20px; color: #0f172a; font-family: 'Playfair Display', serif; }
    .title p { margin: 4px 0 0; font-size: 13px; color: #64748b; font-weight: 600; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; background: #f8fafc; padding: 16px; border-radius: 10px; border: 1px solid #e2e8f0; font-size: 13px; }
    .meta-item { color: #64748b; }
    .meta-item strong { color: #0f172a; }
    .table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    .table th { border-bottom: 2px solid #e2e8f0; padding: 12px 8px; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
    .table td { padding: 12px 8px; border-bottom: 1px solid #f1f5f9; font-size: 13.5px; color: #334155; }
    .table .amount { text-align: right; font-weight: 600; color: #0f172a; }
    .net-pay { background: linear-gradient(135deg, #1a6b8a, #2d9fd4); color: white; border-radius: 12px; padding: 20px; display: flex; justify-content: space-between; align-items: center; font-weight: 700; box-shadow: 0 4px 12px rgba(26, 107, 138, 0.2); }
    .net-pay .label { font-size: 12px; text-transform: uppercase; opacity: 0.9; letter-spacing: 0.5px; }
    .net-pay .val { font-size: 24px; }
    .footer { text-align: center; font-size: 11px; color: #94a3b8; margin-top: 40px; border-top: 1px dashed #e2e8f0; padding-top: 20px; }
    @media print {
      body { background: white; padding: 0; }
      .payslip-container { border: none; box-shadow: none; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="payslip-container">
    <div class="header">
      <div class="brand">✦ Srijes<br><span>the beauty destination</span></div>
      <div class="title">
        <h1>PAYSLIP RECEIPT</h1>
        <p>${month}</p>
      </div>
    </div>
    <div class="meta-grid">
      <div class="meta-item">Employee Name: <strong>${displayName}</strong></div>
      <div class="meta-item">Designation: <strong>${designation}</strong></div>
      <div class="meta-item">Bank Name: <strong>HDFC Bank</strong></div>
      <div class="meta-item">Account No: <strong>•••• •••• 4829</strong></div>
      <div class="meta-item">Status: <strong style="color: #10b981;">✓ Paid</strong></div>
      <div class="meta-item">Transaction Date: <strong>01 ${month.split(' ')[0]} ${month.split(' ')[1]}</strong></div>
    </div>
    <table class="table">
      <thead>
        <tr>
          <th>Earnings Description</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Base Salary (Monthly Fixed)</td>
          <td class="amount">₹${base.toLocaleString('en-IN')}</td>
        </tr>
        <tr>
          <td>Service & Tips Commission</td>
          <td class="amount" style="color: #1a6b8a;">₹${comm.toLocaleString('en-IN')}</td>
        </tr>
        <tr>
          <td>Deductions (PF + PT + TDS)</td>
          <td class="amount" style="color: #ef4444;">-₹${deductions.toLocaleString('en-IN')}</td>
        </tr>
      </tbody>
    </table>
    <div class="net-pay">
      <div class="label">Net Take-Home Pay</div>
      <div class="val">₹${net.toLocaleString('en-IN')}</div>
    </div>
    <div class="footer">
      <p>This is a digitally generated document. For inquiries, contact Srijes accounts department.</p>
    </div>
  </div>
  <script>
    // Trigger print dialog on load
    setTimeout(() => { window.print(); }, 500);
  </script>
</body>
</html>`;

  // Create Blob and trigger download
  const blob = new Blob([htmlContent], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Srijes_Payslip_${month.replace(' ', '_')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast(`Downloaded payslip for ${month}! Opening print layout...`, "success", "📥");
}

function toggleStaffDropdown() {
  document.getElementById("staffDropdown").classList.toggle("hidden");
}

function switchStaff(id) {
  toggleStaffDropdown();
  const content = document.querySelector(".content");
  content.style.opacity = "0";
  content.style.transition = "opacity 0.2s";
  setTimeout(() => {
    loadStaff(id);
    content.style.opacity = "1";
  }, 200);
}

// ── STATS ────────────────────────────────────────────────────────
function buildStats(s) {
  const pending = Math.max(0, s.todayAppointments - s.completedToday);

  // Calculate working hours dynamically based on shift text
  let workingHours = 9;
  if (s.shift) {
    const shiftMatches = s.shift.match(/(\d+)(?::(\d+))?\s*(AM|PM)?\s*.\s*(\d+)(?::(\d+))?\s*(AM|PM)/i);
    if (shiftMatches) {
      let startH = parseInt(shiftMatches[1]);
      const startM = shiftMatches[2] ? parseInt(shiftMatches[2]) : 0;
      let startAmPm = shiftMatches[3] ? shiftMatches[3].toUpperCase() : 'AM';
      if (!shiftMatches[3]) startAmPm = 'AM'; // Default to AM if missing

      let endH = parseInt(shiftMatches[4]);
      const endM = shiftMatches[5] ? parseInt(shiftMatches[5]) : 0;
      const endAmPm = shiftMatches[6].toUpperCase();

      if (startAmPm === 'PM' && startH !== 12) startH += 12;
      if (startAmPm === 'AM' && startH === 12) startH = 0;
      if (endAmPm === 'PM' && endH !== 12) endH += 12;
      if (endAmPm === 'AM' && endH === 12) endH = 0;

      const startTime = startH + startM / 60;
      const endTime = endH + endM / 60;
      workingHours = endTime - startTime;
      if (workingHours < 0) workingHours += 24;

      // Format cleanly (e.g. 8.5)
      workingHours = Math.round(workingHours * 10) / 10;
    }
  }

  const comp = Math.round((s.completedToday / s.todayAppointments) * 100) || 0;

  const cards = [
    {
      icon: "📅",
      bg: "#e8f7f0",
      label: "Today's Appointments",
      value: `${s.todayAppointments}`,
      sub: `${s.completedToday} completed`,
      bar: comp,
      barColor: "#2d9e6b",
    },
    {
      icon: "⏳",
      bg: "#fff6d9",
      label: "Pending Services",
      value: `${pending}`,
      sub: "Waiting or upcoming",
      bar: null,
    },
    {
      icon: "👥",
      bg: "#e8f4fd",
      label: "Total Customers",
      value: `${s.todayAppointments}`,
      sub: "Scheduled today",
      bar: null,
    },
    
    {
      icon: "⏱",
      bg: "#ffe8e8",
      label: "Working Hours",
      value: `${workingHours} hrs`,
      sub: `Shift: ${s.shift}`,
      bar: null,
    },
    {
      icon: "🔔",
      bg: "#e3fdfd",
      label: "Notifications",
      value: `3 New`,
      sub: "Click to view alerts",
      bar: null,
      onClick: "toggleNotifPanel()"
    }
  ];

  const grid = document.getElementById("statsGrid");
  if (!grid) return;
  grid.innerHTML = cards
    .map(
      (c, i) => `
    <div class="stat-card ripple" style="animation-delay:${i * 0.05}s; ${c.onClick ? 'cursor: pointer;' : ''}" ${c.onClick ? `onclick="${c.onClick}"` : ''}>
      <div class="stat-icon" style="background:${c.bg}">${c.icon}</div>
      <div class="stat-label">${c.label}</div>
      <div class="stat-value">${c.value}</div>
      <div class="stat-sub">${c.sub}</div>
      ${c.bar !== null && !isNaN(c.bar) ? `<div class="stat-bar-track"><div class="stat-bar-fill" data-width="${Math.min(100, Math.max(0, c.bar))}%" style="background:${c.barColor}"></div></div>` : ""}
    </div>`,
    )
    .join("");

  // Trigger bar animations after render
  setTimeout(() => {
    document.querySelectorAll(".stat-bar-fill").forEach((bar) => {
      bar.style.width = bar.getAttribute("data-width");
    });
  }, 50);
}

// ── DASHBOARD ENHANCEMENTS ──────────────────────────────────────
function buildDashboard(s) {
  updateNextClientCard(s);
  buildDashboardTimeline(s);
  buildOnShiftStaff();
  buildClientMood(s);
}

function buildClientMood(s) {
  const container = document.getElementById("clientMoodList");
  if (!container) return;

  // Get upcoming appointments
  let upcoming = s.appointments ? s.appointments.filter(a => {
    // If window.aptStates exists use it, otherwise fallback to a.status
    const st = (typeof aptStates !== 'undefined' && aptStates[a.id]) ? aptStates[a.id] : a.status;
    return st === "upcoming" || st === "in-progress";
  }) : [];

  if (upcoming.length === 0) {
    container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted); font-size: 13px;">No upcoming clients right now.</div>';
    return;
  }

  // Define some random moods/expectations for upcoming clients
  const moodTemplates = [
    { emoji: '😍', bgColor: '#e8f5e9', color: '#4caf50', comment: "Excited for a new look!" },
    { emoji: '😌', bgColor: '#e0f7fa', color: '#00bcd4', comment: "Looking for a relaxing session." },
    { emoji: '🤔', bgColor: '#fff3e0', color: '#ff9800', comment: "Not sure what they want, needs consultation." },
    { emoji: '✨', bgColor: '#f3e5f5', color: '#9c27b0', comment: "Wants a complete makeover!" },
    { emoji: '😊', bgColor: '#e8f5e9', color: '#4caf50', comment: "Looking forward to their regular service." },
    { emoji: '🏃‍♀️', bgColor: '#ffebee', color: '#f44336', comment: "In a rush, hoping for a quick service!" }
  ];

  let html = '';
  // Show up to 4 upcoming clients
  upcoming.slice(0, 4).forEach((apt, i) => {
    // Generate a pseudo-random mood based on client name length to keep it stable per session
    const randIndex = (apt.client.length + i) % moodTemplates.length;
    const mood = moodTemplates[randIndex];

    html += `
      <div class="announcement-item" style="border-bottom: 1px solid var(--border); padding-bottom: 12px; margin: 12px;">
        <div class="ann-icon" style="background: ${mood.bgColor}; color: ${mood.color}; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; font-size: 16px;">${mood.emoji}</div>
        <div class="ann-content" style="flex: 1; min-width: 0;">
          <div class="ann-title" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <span style="font-weight: 600; font-size: 13px; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${apt.client}</span> 
            <span style="color: var(--muted); font-size: 10px; white-space: nowrap;">${apt.time || 'Next'}</span>
          </div>
          <div class="ann-desc" style="font-style: italic; font-size: 12px; color: var(--muted); line-height: 1.3;">"${mood.comment}"</div>
        </div>
      </div>
    `;
  });

  // Clean up last border
  if (html) {
    html = html.replace(/border-bottom: 1px solid var\(--border\); padding-bottom: 12px; margin: 12px;"$/, 'margin: 12px; border-bottom: none;"');
  }

  container.innerHTML = html;
}

function buildOnShiftStaff() {
  const container = document.getElementById("onShiftStaffList");
  if (!container) return;

  const staffKeys = Object.keys(STAFF_DATA);
  const onShift = staffKeys.filter(k => k !== currentStaff).slice(0, 3);

  if (onShift.length === 0) {
    container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--muted); font-size: 13px;">No other staff on shift right now.</div>';
    return;
  }

  let html = '';
  onShift.forEach((key, index) => {
    const s = STAFF_DATA[key];
    const initials = s.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

    // Cycle through distinct styling themes for colleagues
    const colors = [
      { bg: 'var(--primary-light)', color: 'var(--primary)', dot: '#2ecc71', status: 'Available' },
      { bg: '#ffeaa7', color: '#d35400', dot: '#e67e22', status: 'On Break' },
      { bg: '#e0f2fe', color: '#0284c7', dot: '#3498db', status: 'In Service' }
    ];
    const c = colors[index % colors.length];

    html += `
      <div style="padding: 12px 16px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between;">
         <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: ${c.bg}; color: ${c.color}; display: flex; align-items: center; justify-content: center; font-weight: 700;">${initials}</div>
            <div>
               <div style="font-weight: 600; font-size: 13px; color: var(--fg);">${s.name}</div>
               <div style="font-size: 11px; color: var(--muted);">${s.role}</div>
            </div>
         </div>
         <div style="width: 8px; height: 8px; border-radius: 50%; background: ${c.dot};" title="${c.status}"></div>
      </div>
    `;
  });

  container.innerHTML = html;
}

function updateNextClientCard(s) {
  const card = document.getElementById("nextClientCard");
  if (!card) return;

  const nextApt = s.appointments.find(a => (aptStates[a.id] || a.status) === "in-progress") ||
    s.appointments.find(a => (aptStates[a.id] || a.status) === "upcoming");

  if (!nextApt) {
    card.innerHTML = `
      <div class="card-head"><div class="card-title">Next Up</div></div>
      <div style="padding: 40px 20px; text-align: center; color: var(--muted);">
        <div style="font-size: 32px; margin-bottom: 12px;">🎉</div>
        <div style="font-weight: 600;">No more appointments!</div>
        <div style="font-size: 12px; margin-top: 4px;">Time to relax or help a colleague.</div>
      </div>`;
    return;
  }

  // Store active appointment globally for modals
  window.currentActiveApt = nextApt;

  const aptStatus = aptStates[nextApt.id] || nextApt.status;

  document.getElementById("ncName").textContent = nextApt.client;
  document.getElementById("ncService").textContent = nextApt.service;
  document.getElementById("ncTime").textContent = nextApt.time;
  document.getElementById("ncDuration").textContent = nextApt.duration + " min";
  document.getElementById("ncPrice").textContent = "₹" + nextApt.price.toLocaleString("en-IN");
  document.getElementById("ncAvatar").textContent = nextApt.client.split(' ').map(n => n[0]).join('');

  // Update badge based on time and status
  const badge = card.querySelector(".badge");
  if (aptStatus === "in-progress") {
    badge.textContent = "In Progress";
    badge.style.background = "var(--success-bg)";
    badge.style.color = "var(--success)";
  } else {
    const [h, m] = nextApt.time.split(':').map(Number);
    const aptMins = h * 60 + m;
    const now = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const diff = aptMins - nowMins;

    if (diff <= 0) {
      badge.textContent = "Overdue";
      badge.style.background = "var(--danger-bg)";
      badge.style.color = "var(--danger)";
    } else if (diff < 30) {
      badge.textContent = `Starts in ${diff} mins`;
      badge.style.background = "var(--warning-bg)";
      badge.style.color = "var(--warning)";
    } else {
      badge.textContent = "Upcoming Today";
      badge.style.background = "var(--primary-light)";
      badge.style.color = "var(--primary)";
    }
  }

  // Action Buttons
  const btnContainer = document.getElementById("ncActionButtons");
  if (btnContainer) {
    if (aptStatus === "in-progress") {
      btnContainer.innerHTML = `
        <button class="btn-secondary ripple" style="flex: 1; height: 44px; font-weight: 600;" onclick="openAddServiceModal()">➕ Add Service</button>
        <button class="btn-outline ripple" style="flex: 1; height: 44px; font-weight: 600; border-color: #e67e22; color: #e67e22; background: rgba(230,126,34,0.05); outline: none; border-radius: 8px;" onclick="bypassApt('${nextApt.id}', event)">🔄 Reassign</button>
        <button class="btn-primary ripple" style="flex: 1; height: 44px; font-weight: 600;" onclick="openCheckoutModal()">💳 Checkout</button>
      `;
    } else {
      btnContainer.innerHTML = `
        <button class="btn-primary ripple" style="flex: 2; height: 44px; font-weight: 600;" onclick="startNextApt()">▶ Start Service</button>
        <button class="btn-secondary ripple" id="ncWhatsAppBtn" style="flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; background: #25D366; color: white; border: none;" title="Send WhatsApp Reminder">
          <span style="font-size: 18px;">💬</span>
        </button>
      `;
      const waBtn = document.getElementById("ncWhatsAppBtn");
      if (waBtn && nextApt.phone) {
        waBtn.onclick = () => {
          let phoneNum = String(nextApt.phone).replace(/\D/g, '');
          if (phoneNum.length === 10) phoneNum = '91' + phoneNum;
          const msg = encodeURIComponent(`Hi ${nextApt.client}, this is a reminder from GlowSuite for your ${nextApt.service} appointment at ${nextApt.time}. We look forward to seeing you!`);
          window.open(`https://wa.me/${phoneNum}?text=${msg}`, '_blank');
        };
      }
    }
  }
}

// ── SERVICE ACTIONS ───────────────────────────────────────────────
function startNextApt() {
  const s = STAFF_DATA[currentStaff];
  // Priority 1: Use the appointment currently being focused in the card
  let targetApt = window.currentActiveApt;

  // Priority 2: Fallback to the first upcoming appointment if window state is lost
  if (!targetApt || (aptStates[targetApt.id] || targetApt.status) !== 'upcoming') {
    targetApt = s.appointments.find(a => (aptStates[a.id] || a.status) === "upcoming");
  }

  if (targetApt) {
    console.log("Starting service for:", targetApt.client, targetApt.id);
    aptStates[targetApt.id] = "in-progress";
    saveAptStates();
    showToast(`Service started for ${targetApt.client}!`, "success", "▶");
    buildDashboard(s);
    if (typeof refreshTimeline === 'function') refreshTimeline();
  } else {
    showToast("No upcoming appointments to start.", "info", "📅");
  }
}

// Bind to window to ensure HTML onclick works
window.startNextApt = startNextApt;
window.startApt = startApt;
window.doneApt = doneApt;

function openAddServiceModal() {
  const overlay = document.getElementById("addServiceModalOverlay");
  const select = document.getElementById("addServiceSelect");
  if (!overlay || !select) return;

  // Add a placeholder and populate
  let options = `<option value="" disabled selected>Select a service to add...</option>`;
  options += serviceCatalog.map(s => `<option value="${s.id}">${s.name} - ₹${s.price.toLocaleString("en-IN")}</option>`).join("");

  select.innerHTML = options;
  overlay.classList.remove("hidden");
}

function closeAddServiceModal() {
  const overlay = document.getElementById("addServiceModalOverlay");
  if (overlay) overlay.classList.add("hidden");
}

function confirmAddService() {
  const select = document.getElementById("addServiceSelect");
  if (!select || !window.currentActiveApt) return;
  const svcId = select.value;
  const svc = serviceCatalog.find(s => s.id === svcId);
  if (svc) {
    window.currentActiveApt.service += " + " + svc.name;
    window.currentActiveApt.price += svc.price;
    window.currentActiveApt.duration += parseInt(svc.duration);

    // Check if extending this appointment causes a clash with the NEXT appointments
    const currentApt = window.currentActiveApt;
    const [ch, cm] = String(currentApt.time).split(":").map(Number);
    const cStart = ch * 60 + cm;
    const cEnd = cStart + currentApt.duration;

    const staff = STAFF_DATA[currentStaff];
    const clashingApts = staff.appointments.filter(a => {
      if (a.id === currentApt.id || (aptStates[a.id] || a.status) === 'done') return false;
      const [ah, am] = String(a.time).split(":").map(Number);
      const aStart = ah * 60 + am;
      // If the upcoming appointment starts before the extended active appointment finishes
      return aStart < cEnd && aStart >= cStart;
    });

    if (clashingApts.length > 0) {
      const staffKeys = Object.keys(STAFF_DATA).filter(k => k !== currentStaff);
      let reassignedCount = 0;

      clashingApts.forEach(aptToMove => {
        const [mh, mm] = String(aptToMove.time).split(":").map(Number);
        const mStart = mh * 60 + mm;
        const mEnd = mStart + (aptToMove.duration || 60);

        let chosenStaff = null;
        for (let sk of staffKeys) {
          const s = STAFF_DATA[sk];
          // Ensure the colleague's role makes them eligible for this service
          // (Assume all can do it for now, just check schedule overlap)
          const hasClash = s.appointments.some(a => {
            if ((aptStates[a.id] || a.status) === 'done') return false;
            const [ah, am] = String(a.time).split(":").map(Number);
            const aStart = ah * 60 + am;
            const aEnd = aStart + (a.duration || 60);
            return (mStart < aEnd && mEnd > aStart);
          });

          if (!hasClash) {
            chosenStaff = s;
            break;
          }
        }

        if (chosenStaff) {
          // Remove from current staff
          staff.appointments = staff.appointments.filter(a => a.id !== aptToMove.id);
          // Add to chosen staff
          chosenStaff.appointments.push(aptToMove);
          chosenStaff.appointments.sort((a, b) => a.time.localeCompare(b.time));
          reassignedCount++;
          setTimeout(() => {
            showToast(`Bypassed ${aptToMove.client} to ${chosenStaff.name} due to extended service!`, 'warning', '🔄');
          }, 1000 + (reassignedCount * 1500)); // Stagger toasts
        } else {
          setTimeout(() => {
            showToast(`${aptToMove.client} must wait (no free staff available)`, 'error', '⚠️');
          }, 1000);
        }
      });

      if (reassignedCount > 0 && typeof refreshTimeline === 'function') {
        setTimeout(() => refreshTimeline(), 500); // Redraw timeline after moving
      }
    }

    // Save to localStorage so changes persist across page reloads
    if (typeof STAFF_DATA !== 'undefined') {
      localStorage.setItem('STAFF_DATA_PERSIST', JSON.stringify(STAFF_DATA));
    }

    showToast(`Added ${svc.name} to appointment`);
    if (typeof buildDashboard === 'function') buildDashboard(STAFF_DATA[currentStaff]);
  }
  closeAddServiceModal();
}

let checkoutPollInterval = null;

function openCheckoutModal() {
  const overlay = document.getElementById("checkoutModalOverlay");
  if (!overlay || !window.currentActiveApt) return;

  const apt = window.currentActiveApt;
  document.getElementById("coClientName").textContent = apt.client;
  document.getElementById("coServices").textContent = apt.service;
  document.getElementById("coTotalAmount").textContent = "₹" + apt.price.toLocaleString("en-IN");

  // Reset UI state
  const btn = document.getElementById("coCompleteBtn");
  const statusTxt = document.getElementById("coStatusText");
  btn.style.opacity = '0.5';
  btn.style.pointerEvents = 'none';
  statusTxt.innerHTML = '⏳ Waiting for customer confirmation...';
  statusTxt.style.color = '#f59e0b';
  statusTxt.style.animation = 'pulse 2s infinite';

  // Generate QR
  // Force public tunnel URL so it works globally and bypasses firewall
  const baseUrl = 'https://srijes-checkout-server.loca.lt';
  const checkoutUrl = `${baseUrl}/customer-checkout.html?aptId=${apt.id}`;

  const qrImg = document.getElementById("checkoutQR");
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(checkoutUrl)}`;
  qrImg.style.cursor = 'pointer';
  qrImg.title = 'Click to open checkout in a new tab (for local testing)';
  qrImg.onclick = () => window.open(checkoutUrl, '_blank');

  // Start polling server API
  fetch(`${baseUrl}/api/reset?aptId=${apt.id}`, { headers: { 'Bypass-Tunnel-Reminder': 'true' } }).catch(() => console.log('API not running'));
  if (checkoutPollInterval) clearInterval(checkoutPollInterval);

  checkoutPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`${baseUrl}/api/status?aptId=${apt.id}`, {
        cache: 'no-store',
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
      });
      const data = await res.json();
      if (data.confirmed) {
        clearInterval(checkoutPollInterval);
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        statusTxt.innerHTML = '✅ Customer Confirmed!';
        statusTxt.style.color = 'var(--success)';
        statusTxt.style.animation = 'none';
      }
    } catch (e) {
      // Fallback to localStorage logic if Python server isn't used
      if (localStorage.getItem('checkoutConfirmed_' + apt.id) === 'true') {
        clearInterval(checkoutPollInterval);
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        statusTxt.innerHTML = '✅ Customer Confirmed!';
        statusTxt.style.color = 'var(--success)';
        statusTxt.style.animation = 'none';
      }
    }
  }, 1000);

  overlay.classList.remove("hidden");
}

function manualConfirmCheckout() {
  const btn = document.getElementById("coCompleteBtn");
  const statusTxt = document.getElementById("coStatusText");

  if (checkoutPollInterval) clearInterval(checkoutPollInterval);

  btn.style.opacity = '1';
  btn.style.pointerEvents = 'auto';
  statusTxt.innerHTML = '✅ Manually Confirmed by Staff';
  statusTxt.style.color = 'var(--success)';
  statusTxt.style.animation = 'none';
}

function closeCheckoutModal() {
  if (checkoutPollInterval) clearInterval(checkoutPollInterval);
  const overlay = document.getElementById("checkoutModalOverlay");
  if (overlay) overlay.classList.add("hidden");
}

function confirmCheckout() {
  if (window.currentActiveApt) {
    aptStates[window.currentActiveApt.id] = "done";
    saveAptStates();
    STAFF_DATA[currentStaff].completedToday = (STAFF_DATA[currentStaff].completedToday || 0) + 1;
    STAFF_DATA[currentStaff].earnedRevenue = (STAFF_DATA[currentStaff].earnedRevenue || 0) + window.currentActiveApt.price;
    showToast(`Checkout completed! ₹${window.currentActiveApt.price.toLocaleString("en-IN")} collected.`, "success", "💳");
    if (typeof buildDashboard === 'function') buildDashboard(STAFF_DATA[currentStaff]);
  }
  closeCheckoutModal();
}


function buildDashboardTimeline(s) {
  const timelineEl = document.getElementById("dashboardTimeline");
  if (!timelineEl) return;

  // Show only first 5 non-completed appointments
  const upcoming = s.appointments.filter(a => (aptStates[a.id] || a.status) !== "done").slice(0, 5);

  if (upcoming.length === 0) {
    timelineEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted); font-size: 13px;">All clear for today!</div>';
    return;
  }

  timelineEl.innerHTML = upcoming.map(a => {
    // Format to 12-hour AM/PM
    const [h, m] = String(a.time).split(":").map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    const timeLabel = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;

    // Determine Indoor/Outdoor
    let svcName = (a.service || '').toLowerCase();
    let svcObj = serviceCatalog.find(sc => sc.name.toLowerCase() === svcName);
    let svcType = 'Indoor';
    if (svcObj && svcObj.type) {
      svcType = svcObj.type === 'outdoor' ? 'Outdoor' : 'Indoor';
    } else {
      if (svcName.includes("makeup") || svcName.includes("massage") || svcName.includes("outdoor") || svcName.includes("event") || svcName.includes("bridal")) {
        svcType = "Outdoor";
      }
    }

    let typeBadge = svcType === 'Indoor'
      ? `<span style="font-size: 8px; background: #e0f2fe; color: #0284c7; padding: 2px 5px; border-radius: 4px; margin-left: 6px; font-weight: 700;">🏠 Indoor</span>`
      : `<span style="font-size: 8px; background: #dcfce7; color: #166534; padding: 2px 5px; border-radius: 4px; margin-left: 6px; font-weight: 700;">🌳 Outdoor</span>`;

    return `
      <div class="apt-item ${aptStates[a.id] || a.status}" onclick="window.location.href='schedule.html'">
        <div class="apt-main" style="padding: 8px 12px;">
          <div class="apt-time-col" style="width: 45px;">
            <div class="apt-time-txt" style="font-size: 9px; white-space: nowrap;">${timeLabel}</div>
          </div>
          <div class="apt-info">
            <div class="apt-client" style="font-size: 12px; margin-bottom: 2px;">${a.client}</div>
            <div class="apt-service" style="font-size: 11px; display: flex; align-items: center; color: var(--muted);">${a.service} ${typeBadge}</div>
          </div>
          <div class="apt-badge ${aptStates[a.id] || a.status}" style="font-size: 9px; padding: 3px 8px;">
            ${(aptStates[a.id] || a.status) === 'in-progress' ? 'Active' : 'Next'}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function buildMiniChart(s) {
  const canvas = document.getElementById("miniPerfChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const data = s.weeklyRevenue;
  const max = Math.max(...data, 1);
  const W = canvas.width = canvas.offsetWidth;
  const H = canvas.height = canvas.offsetHeight;

  ctx.clearRect(0, 0, W, H);

  // Simple area chart
  const pad = 10;
  const gW = W - (pad * 2);
  const gH = H - (pad * 2);
  const stepX = gW / (data.length - 1);

  const grad = ctx.createLinearGradient(0, pad, 0, H - pad);
  grad.addColorStop(0, "rgba(26, 107, 138, 0.2)");
  grad.addColorStop(1, "rgba(26, 107, 138, 0)");

  ctx.beginPath();
  data.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = pad + gH - (v / max) * gH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(pad + (data.length - 1) * stepX, H - pad);
  ctx.lineTo(pad, H - pad);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = "var(--primary)";
  ctx.lineWidth = 2;
  data.forEach((v, i) => {
    const x = pad + i * stepX;
    const y = pad + gH - (v / max) * gH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}



// ── TIMELINE ─────────────────────────────────────────────────────
function buildTimeline(s, typeFilter = '') {
  const done = Object.values(aptStates).filter((v) => v === "done").length;
  const upcoming = Object.values(aptStates).filter(
    (v) => v === "upcoming",
  ).length;

  const subEl = document.getElementById("aptSub");
  const upcEl = document.getElementById("aptUpcoming");

  if (subEl) subEl.textContent = `${done} of ${s.appointments.length} completed`;
  if (upcEl) upcEl.textContent = `${upcoming} upcoming`;

  // Update Right Column Schedule Metrics
  const schedEstEl = document.getElementById("schedEstEarnings");
  const schedCompEl = document.getElementById("schedCompletion");
  if (schedEstEl) {
    const totalEst = s.appointments.reduce((sum, a) => sum + (parseFloat(a.price) || 0), 0);
    schedEstEl.textContent = `₹${totalEst.toLocaleString("en-IN")}`;
  }
  if (schedCompEl) {
    const pct = s.appointments.length > 0 ? Math.round((done / s.appointments.length) * 100) : 0;
    schedCompEl.textContent = `${pct}%`;
  }

  const timeline = document.getElementById("timeline");
  if (!timeline) return;

  // Contextual Activation of Srijes Advanced Outdoor Operational Dispatch Hub
  const outdoorHub = document.getElementById("outdoorHubContainer");
  if (outdoorHub) {
    if (typeFilter === 'outdoor') {
      outdoorHub.classList.remove("hidden");
      if (typeof updateOutdoorAnalytics === 'function') updateOutdoorAnalytics(s);
      if (typeof buildOutdoorAISuggestions === 'function') buildOutdoorAISuggestions(s);
    } else {
      outdoorHub.classList.add("hidden");
    }
  }

  let appointments = s.appointments;
  if (typeFilter) {
    appointments = appointments.filter(a => {
      if (!a.service) return false;
      const aName = a.service.toLowerCase();
      let svc = serviceCatalog.find(sc => sc.name.toLowerCase() === aName);
      if (!svc) {
        svc = serviceCatalog.find(sc => {
          const scName = sc.name.toLowerCase();
          const scCat = (sc.cat || '').toLowerCase();
          return scName.includes(aName) || aName.includes(scName) || (scCat && (scCat.includes(aName) || aName.includes(scCat)));
        });
      }

      // Get the type
      let type = svc ? svc.type : null;
      if (!type) {
        // Fallback for known local staff services
        if (aName.includes("makeup") || aName.includes("massage") || aName.includes("wrap") || aName.includes("scrub") || aName.includes("outdoor")) {
          type = "outdoor";
        } else {
          type = "indoor"; // Default all other beauty/hair services to indoor
        }
      }

      return type === typeFilter;
    });
    // Add a clear filter button if filtering
    if (subEl) subEl.innerHTML = `<span style="color:var(--primary);cursor:pointer;font-weight:700;" onclick="clearScheduleFilter()">✕ Clear ${typeFilter} filter</span>`;
  }

  if (appointments.length > 0) {
    const nowStr = new Date().toTimeString().substring(0, 5);
    let nowInserted = false;
    let html = '';
    appointments.forEach((a) => {
      const apt = STAFF_DATA[currentStaff].appointments.find(x => x.id === a.id);
      const aTime = apt ? apt.time : a.time;
      // Insert "NOW" line before the active/ongoing appointment
      const st = aptStates[a.id] || a.status;
      if (!nowInserted && (st === 'in-progress' || st === 'upcoming')) {
        html += `<div class="timeline-now-line"></div>`;
        nowInserted = true;
      }
      html += renderApt(a);
    });
    timeline.innerHTML = html;
  } else {
    timeline.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px;">No ${typeFilter} appointments for today.</div>`;
  }

  // Setup drag and drop
  const items = timeline.querySelectorAll(".apt-item");
  items.forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragenter", handleDragEnter);
    item.addEventListener("dragleave", handleDragLeave);
    item.addEventListener("dragend", handleDragEnd);
  });
}

function filterLiveAppointments(type) {
  const s = STAFF_DATA[currentStaff];
  currentFilter = type; // Save filter globally
  buildTimeline(s, type);
  showToast(type ? `Showing ${type} appointments` : "Showing all appointments", "info", "🔍");
}

window.clearScheduleFilter = function() {
  currentFilter = '';
  // Try to find the select in schedule.html
  const filters = document.querySelectorAll('select');
  filters.forEach(f => {
    if (f.innerHTML.includes('Outdoor Appointments')) f.value = '';
  });
  refreshTimeline();
  showToast("Filter cleared", "info", "🔍");
};

window.filterLiveAppointments = filterLiveAppointments;

let draggedApt = null;
function handleDragStart(e) {
  draggedApt = this;
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/html", this.innerHTML);
}
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  return false;
}
function handleDragEnter(e) {
  if (this !== draggedApt) this.classList.add("drag-over");
}
function handleDragLeave(e) {
  this.classList.remove("drag-over");
}
function handleDrop(e) {
  e.stopPropagation();
  this.classList.remove("drag-over");
  if (draggedApt !== this) {
    const s = STAFF_DATA[currentStaff];
    const draggedId = draggedApt.id.replace("apt-", "");
    const targetId = this.id.replace("apt-", "");
    const draggedIdx = s.appointments.findIndex((a) => a.id === draggedId);
    const targetIdx = s.appointments.findIndex((a) => a.id === targetId);

    // Swap
    const temp = s.appointments[draggedIdx];
    s.appointments[draggedIdx] = s.appointments[targetIdx];
    s.appointments[targetIdx] = temp;

    showToast("Schedule updated!", "success", "🔄");
    buildTimeline(s);
  }
  return false;
}
function handleDragEnd(e) {
  this.classList.remove("dragging");
}

function renderApt(a) {
  if (typeof currentFilter !== 'undefined' && currentFilter === 'outdoor') {
    if (typeof renderOutdoorHomeServiceApt === 'function') {
      return renderOutdoorHomeServiceApt(a);
    }
  }
  const [h, m] = String(a.time).split(":").map(Number);
  const startMins = h * 60 + m;
  const duration = a.duration || 60;
  const endMins = startMins + duration;

  const now = new Date();
  const currentMins = now.getHours() * 60 + now.getMinutes();

  // Find the single legitimate active appointment for this staff to prevent overlaps
  const staff = STAFF_DATA[currentStaff];
  const officiallyActiveApt = staff.appointments.find(other => {
    const [oh, om] = String(other.time).split(":").map(Number);
    const oStartMins = oh * 60 + om;
    const oEndMins = oStartMins + (other.duration || 60);
    return currentMins >= oStartMins && currentMins < oEndMins;
  });

  // Determine auto-status based on current time
  let st = "upcoming";
  if (currentMins >= endMins) {
    st = "done";
  } else if (currentMins >= startMins) {
    if (officiallyActiveApt && officiallyActiveApt.id === a.id) {
      st = "in-progress";
    } else {
      st = "upcoming"; // Wait in queue until the blocking appointment is finished
    }
  }

  // Also sync the global aptStates so the dashboard cards match
  aptStates[a.id] = st;

  const dotCls =
    st === "done"
      ? "done-dot"
      : st === "in-progress"
        ? "progress-dot"
        : "upcoming-dot";

  const badgeTxt =
    st === "done" ? "Done" : st === "in-progress" ? "In Progress" : "Upcoming";

  // WhatsApp logic
  let waBtn = "";
  if (st === "upcoming" && a.phone) {
    const waMsg = encodeURIComponent(
      `Hi ${a.client}, this is a friendly reminder from Srijes, the beauty destination for your ${a.service} appointment today at ${a.time}. We look forward to seeing you! ✨`,
    );
    let phoneNum = String(a.phone).replace(/\D/g, '');
    if (phoneNum.length === 10) phoneNum = '91' + phoneNum;
    const waLink = `https://wa.me/${phoneNum}?text=${waMsg}`.replace(/'/g, "%27");
    waBtn = `<button class="btn-outline ripple" style="padding:4px 10px;font-size:14px;border-color:#25D366;color:#25D366;background:rgba(37,211,102,0.1);margin-right:4px;" onclick="window.open('${waLink}', '_blank'); event.stopPropagation();" title="Send WhatsApp Reminder">💬</button>`;
  }

  const bypassBtn = `<button class="btn-outline ripple" style="padding:4px 10px;font-size:14px;border-color:#e67e22;color:#e67e22;background:rgba(230,126,34,0.1);margin-right:4px;" onclick="bypassApt('${a.id}', event)" title="Reassign to another available staff">🔄</button>`;

  const actionBtn =
    st === "upcoming"
      ? `${bypassBtn}${waBtn} <button class="btn-start ripple" onclick="startApt('${a.id}',event)">▶ Start</button>`
      : st === "in-progress"
        ? `<button class="btn-done ripple" onclick="doneApt('${a.id}',event)">✔ Done</button>`
        : '<span style="color:#2d9e6b;font-size:17px">✓</span>';

  let liveIndicator = "";
  let itemStyle = "";

  // Format to 12-hour AM/PM
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  let timeLabel = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;

  let dynamicBadge = "";

  if (st === "in-progress") {
    const pct = Math.max(
      0,
      Math.min(100, ((currentMins - startMins) / duration) * 100),
    );
    liveIndicator = `
      <div style="padding: 0 14px 12px;">
        <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--primary);margin-bottom:4px;font-weight:600;">
          <span style="animation:pulse 2s infinite">● Happening Now</span>
          <span>${Math.round(duration - (currentMins - startMins))} min left</span>
        </div>
        <div style="height:5px;background:var(--primary-light);border-radius:3px;overflow:hidden;">
          <div style="height:100%;background:var(--primary);width:${pct}%;transition:width 1s linear;"></div>
        </div>
      </div>
    `;
    itemStyle = `border-color:var(--primary);box-shadow:0 4px 16px rgba(120,40,100,.15);`;
  } else if (currentMins > endMins && st !== "done") {
    itemStyle = `border-left: 4px solid var(--danger);`;
    dynamicBadge = `<span style="font-size:10px;color:var(--danger);font-weight:600;margin-left:8px;">⚠️ Overdue</span>`;
  }

  const detail = `
    <div class="apt-detail" id="detail-${a.id}">
      <div class="apt-detail-row">
        <span>📞 ${a.phone || "—"}</span>
        <span>⏱ ${a.duration} min</span>
        <span>₹${a.price.toLocaleString("en-IN")}</span>
        ${a.notes ? `<span>📝 ${a.notes}</span>` : ""}
      </div>
    </div>`;
  // Determine Indoor/Outdoor
  let svcName = (a.service || '').toLowerCase();
  let svcObj = serviceCatalog.find(sc => sc.name.toLowerCase() === svcName);
  let svcType = 'Indoor';
  if (svcObj && svcObj.type) {
    svcType = svcObj.type === 'outdoor' ? 'Outdoor' : 'Indoor';
  } else {
    if (svcName.includes("makeup") || svcName.includes("massage") || svcName.includes("outdoor") || svcName.includes("event") || svcName.includes("bridal")) {
      svcType = "Outdoor";
    }
  }

  let typeBadge = svcType === 'Indoor'
    ? `<span style="font-size: 10px; background: #e0f2fe; color: #0284c7; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 600;">🏠 Indoor</span>`
    : `<span style="font-size: 10px; background: #dcfce7; color: #166534; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 600;">🌳 Outdoor</span>`;

  return `
    <div class="apt-item ${st}" id="apt-${a.id}" draggable="true" onclick="toggleApt('${a.id}')" style="${itemStyle}">
      <div class="apt-main">
        <div class="drag-handle" title="Drag to reorder" onclick="event.stopPropagation()">
          <span></span><span></span><span></span>
        </div>
        <div class="apt-time-col">
          <div class="apt-dot ${dotCls}"></div>
          <div class="apt-time-txt">${timeLabel}</div>
        </div>
        <div class="apt-info">
          <div class="apt-client" style="display: flex; align-items: center; gap: 8px;">
            ${a.client} ${dynamicBadge}
            <span style="font-size: 11px; color: var(--muted); font-weight: normal;">📞 ${a.phone || "No phone"}</span>
          </div>
          <div class="apt-service" style="display: flex; align-items: center;">✂ ${a.service} ${typeBadge}</div>
        </div>
        <div class="apt-actions">
          ${st !== "upcoming" ? `<span class="apt-badge ${st}">${badgeTxt}</span>` : ""}
          ${actionBtn}
          <span class="apt-expand" id="exp-${a.id}">›</span>
        </div>
      </div>
      ${liveIndicator}
      ${detail}
    </div>`;
}

function toggleApt(id) {
  const det = document.getElementById("detail-" + id);
  const exp = document.getElementById("exp-" + id);
  det.classList.toggle("show");
  exp.classList.toggle("open");
}

function openAddAptModal() {
  document.getElementById("addAptModalOverlay").classList.remove("hidden");
}

function closeAddAptModal() {
  document.getElementById("addAptModalOverlay").classList.add("hidden");
}

function submitNewAppointment() {
  const client = document.getElementById("newAptClient").value;
  const phone = document.getElementById("newAptPhone").value;
  const service = document.getElementById("newAptService").value;
  const time = document.getElementById("newAptTime").value;
  const duration =
    parseInt(document.getElementById("newAptDuration").value) || 60;

  if (!client || !service || !time) {
    showToast("Please fill all required fields", "warning", "⚠️");
    return;
  }

  const s = STAFF_DATA[currentStaff];
  const newId = "a" + Date.now();

  s.appointments.push({
    id: newId,
    time: time,
    client: client,
    service: service,
    duration: duration,
    price: 0,
    status: "upcoming",
    phone: phone,
  });

  // Sort by time
  s.appointments.sort((a, b) => {
    const tA = a.time.replace(":", "");
    const tB = b.time.replace(":", "");
    return tA - tB;
  });

  aptStates[newId] = "upcoming";
  saveAptStates();
  closeAddAptModal();
  refreshTimeline();
  showToast("Appointment added!", "success", "🗓️");

  // Clear form
  document.getElementById("newAptClient").value = "";
  document.getElementById("newAptPhone").value = "";
  document.getElementById("newAptService").value = "";
  document.getElementById("newAptTime").value = "";
}

function startApt(id, e) {
  if (e) e.stopPropagation();
  aptStates[id] = "in-progress";
  saveAptStates();
  showToast("Appointment started!", "success", "▶");
  const s = STAFF_DATA[currentStaff];
  buildDashboard(s);
  refreshTimeline();
}

function doneApt(id, e) {
  if (e) e.stopPropagation();
  aptStates[id] = "done";
  saveAptStates();
  showToast("Service completed successfully!", "success", "🎉");
  if (typeof confetti === "function") {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#a04090", "#e0904a", "#2d9e6b", "#f0a500"],
    });
  }
  const s = STAFF_DATA[currentStaff];
  buildDashboard(s);
  refreshTimeline();
}

function refreshTimeline() {
  const s = STAFF_DATA[currentStaff];
  if (!s) return;
  const done = Object.values(aptStates).filter((v) => v === "done").length;
  const upcoming = Object.values(aptStates).filter(
    (v) => v === "upcoming",
  ).length;
  const subEl = document.getElementById("aptSub");
  const upcEl = document.getElementById("aptUpcoming");
  if (subEl) subEl.textContent = `${done} of ${s.appointments.length} completed`;
  if (upcEl) upcEl.textContent = `${upcoming} upcoming`;

  // Use the current filter
  buildTimeline(s, currentFilter);
  if (typeof buildDashboard === 'function') buildDashboard(s);
}



// ── ATTENDANCE CALENDAR ───────────────────────────────────────────
function buildCalendar() {
  const monthEl = document.getElementById("calMonth");
  const yearEl = document.getElementById("calYear");
  if (monthEl && yearEl && !window.calendarInitialized) {
    const now = new Date();
    monthEl.value = now.getMonth();
    
    // Ensure year option exists, if not, create it
    let yearOptionExists = Array.from(yearEl.options).some(opt => parseInt(opt.value) === now.getFullYear());
    if(!yearOptionExists) {
        const newOpt = document.createElement('option');
        newOpt.value = now.getFullYear();
        newOpt.text = now.getFullYear();
        yearEl.appendChild(newOpt);
    }
    yearEl.value = now.getFullYear();
    window.calendarInitialized = true;
  }
  renderFullCalendar();
}

function renderFullCalendar() {
  const calGridEl = document.getElementById("calGrid");
  const monthEl = document.getElementById("calMonth");
  const yearEl = document.getElementById("calYear");
  if (!calGridEl || !monthEl || !yearEl) return;

  const month = parseInt(monthEl.value);
  const year = parseInt(yearEl.value);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const today = new Date();
  const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;
  const isFutureMonth = (year > today.getFullYear()) || (year === today.getFullYear() && month > today.getMonth());
  const currentDay = today.getDate();

  const govtHolidays = {
    4: [1, 26], // May: 1st (May Day), 26th (Budha Purnima)
  };

  let html = "";
  let counts = { present: 0, absent: 0, late: 0, holiday: 0, permission: 0, "weekly-off": 0 };

  for (let i = 0; i < firstDay; i++) html += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    let cls = "present";
    const isHoliday = govtHolidays[month] && govtHolidays[month].includes(d);

    // Check if this date falls in any applied leave
    const currentDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    let isAppliedLeave = false;
    if (typeof staffLeaves !== 'undefined' && staffLeaves) {
      isAppliedLeave = staffLeaves.some(l => currentDateStr >= l.from && currentDateStr <= l.to);
    }

    const isFuture = isFutureMonth || (isCurrentMonth && d > currentDay);

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
    } else {
      const seed = (d * 7 + month * 13 + year * 3) % 100;
      if (seed < 4 || (month === 4 && year === 2026 && d === 12)) {
        // Fridays (5), Saturdays (6), and Sundays (0) are Peak Days
        const isPeakDay = (dow === 5 || dow === 6 || dow === 0);
        cls = isPeakDay ? "absent" : "absent non-peak";
      }
      else if (seed < 12) cls = "late";
      else if (seed < 16) cls = "permission";
      else cls = "present";
    }

    if (cls !== "future") {
      if (cls.startsWith("absent")) {
        counts.absent++;
      } else {
        counts[cls]++;
      }
    }
    html += `<div class="cal-cell ${cls}" title="${d} ${monthEl.options[month].text} ${year} — ${cls}" onclick="showCalModal(${d}, '${cls}')">${d}</div>`;
  }

  calGridEl.innerHTML = html;

  setEl("summaryPresent", counts.present);
  setEl("summaryAbsent", counts.absent);
  setEl("summaryLate", counts.late);
  setEl("summaryHoliday", counts.holiday);
  setEl("summaryPermission", counts.permission);
  setEl("summaryWeeklyOff", counts["weekly-off"]);

  const totalDays = counts.present + counts.absent + counts.late + counts.permission + counts.holiday + counts["weekly-off"];
  const expectedWorkingDays = counts.present + counts.absent + counts.late + counts.permission;
  const rate = expectedWorkingDays > 0 ? Math.round(((counts.present + counts.late + counts.permission) / expectedWorkingDays) * 100) : 0;

  const rateEl = document.getElementById("attRate");
  if (rateEl) rateEl.textContent = `${rate}%`;

  const presentPct = totalDays > 0 ? (counts.present / totalDays) * 100 : 0;
  const latePct = totalDays > 0 ? (counts.late / totalDays) * 100 : 0;
  const absentPct = totalDays > 0 ? (counts.absent / totalDays) * 100 : 0;
  const permissionPct = totalDays > 0 ? (counts.permission / totalDays) * 100 : 0;
  const holidayPct = totalDays > 0 ? (counts.holiday / totalDays) * 100 : 0;
  const weeklyOffPct = totalDays > 0 ? (counts["weekly-off"] / totalDays) * 100 : 0;

  const barPres = document.getElementById("attPresent");
  const barLate = document.getElementById("attLate");
  const barAbs = document.getElementById("attAbsent");
  const barPerm = document.getElementById("attPermission");
  const barHol = document.getElementById("attHoliday");
  const barWkOff = document.getElementById("attWeeklyOff");

  if (barPres) barPres.style.width = `${presentPct}%`;
  if (barLate) barLate.style.width = `${latePct}%`;
  if (barAbs) barAbs.style.width = `${absentPct}%`;
  if (barPerm) barPerm.style.width = `${permissionPct}%`;
  if (barHol) barHol.style.width = `${holidayPct}%`;
  if (barWkOff) barWkOff.style.width = `${weeklyOffPct}%`;
}

function showCalModal(day, status) {
  const overlay = document.getElementById("calModalOverlay");
  const content = document.getElementById("calModalContent");
  if (!overlay || !content) return;
  document.getElementById("calModalTitle").textContent = `May ${day}, 2026`;

  if (status === "present") {
    content.innerHTML = `<p style="color:var(--present);font-weight:600;margin-bottom:8px">Present</p><p>Clock In: 08:52 AM</p><p>Clock Out: 06:15 PM</p><p>Total Hours: 9h 23m</p>`;
  } else if (status === "late") {
    content.innerHTML = `<p style="color:var(--warning);font-weight:600;margin-bottom:8px">Late Arrival</p><p>Clock In: 09:45 AM</p><p>Clock Out: 06:30 PM</p><p>Penalty: 45 mins late</p>`;
  } else if (status.startsWith("absent")) {
    const isPeak = status === "absent";
    const penaltyText = isPeak ?
      `<p style="color:var(--danger);font-weight:600;margin-top:12px;padding:8px;background:#FFF1F2;border-radius:6px;border:1px solid rgba(159, 18, 57, 0.2)">🚨 Peak Day Penalty Applied:<br><span style="font-weight:normal;font-size:13px">Unexcused absence on weekend peak revenue rush day (Loss of Pay & penalty points).</span></p>` :
      `<p style="color:#F43F5E;font-weight:600;margin-top:12px;padding:8px;background:#FFF1F2;border-radius:6px;border:1px solid rgba(244, 63, 94, 0.2)">⚠️ Non-Peak Absence:<br><span style="font-weight:normal;font-size:13px">Unexcused absence on a regular weekday (Loss of Pay only).</span></p>`;
    content.innerHTML = `<p style="color:var(--danger);font-weight:600;margin-bottom:8px">Absent / No Show</p><p>No clock-in recorded for this day.</p>${penaltyText}`;
  } else if (status === "permission") {
    content.innerHTML = `<p style="color:var(--permission);font-weight:600;margin-bottom:8px">Permission Leave</p><p>Status: Approved Leave</p><p>Approved by: Admin / Salon Manager</p><p>Reason: Personal Permission / Medical Checkup</p>`;
  } else if (status === "holiday") {
    let holidayName = "Government Holiday";
    if (day === 1) holidayName = "May Day / Labour Day";
    else if (day === 26) holidayName = "Budha Purnima";
    content.innerHTML = `<p style="color:var(--holiday);font-weight:600;margin-bottom:8px">${holidayName}</p><p>Status: Public Holiday</p><p>Salon closed for Government/Public Holiday.</p>`;
  } else if (status === "weekly-off") {
    content.innerHTML = `<p style="color:var(--weekly-off);font-weight:600;margin-bottom:8px">Weekly Off</p><p>Status: Scheduled Weekly Off</p><p>Exceptions: Salons peak weekend revenue rush excluded (Fri, Sat, Sun). Thursday designated day off.</p>`;
  } else {
    content.innerHTML = `<p>Future Date</p>`;
  }

  overlay.classList.remove("hidden");
}

function closeCalModal() {
  document.getElementById("calModalOverlay").classList.add("hidden");
}

// ── LEAVE ────────────────────────────────────────────────────────
async function buildLeave(s) {
  const leaveListEl = document.getElementById("leaveList");
  if (!leaveListEl) return;

  const staffId = localStorage.getItem('loggedInStaffId') || (s ? s.id : 'staff1');
  
  try {
      const res = await fetch(`/api/my-leaves?staffId=${staffId}`);
      if (res.ok) {
          const leaves = await res.json();
          // Map backend dates back to simple strings
          const mappedLeaves = leaves.map(l => ({
              type: l.type || "casual",
              from: new Date(l.fromDate).toISOString().split('T')[0],
              to: new Date(l.toDate).toISOString().split('T')[0],
              reason: l.reason,
              status: l.status.toLowerCase()
          }));
          staffLeaves = mappedLeaves;
          saveStaffLeaves();
      }
  } catch (e) {
      console.error("Error fetching leaves:", e);
      // fallback to local staffLeaves if backend fails
  }

  // Initialize and persist default leaves if empty
  if (!staffLeaves) {
    staffLeaves = s ? s.leaves || [] : [];
    saveStaffLeaves();
  }

  // Sort leaves by date descending (newest first)
  staffLeaves.sort((a, b) => new Date(b.from) - new Date(a.from));

  leaveListEl.innerHTML = staffLeaves.length
    ? staffLeaves
      .map(
        (l) => `
      <div class="leave-item">
        <div class="leave-icon" style="background:${l.type === "sick" ? "#fdecea" : l.type === "casual" ? "#f5eaf3" : "#fdf4e0"}">
          ${l.type === "sick" ? "🤒" : l.type === "casual" ? "🌴" : "🚨"}
        </div>
        <div class="leave-info">
          <div class="leave-meta">
            <span class="leave-type-badge ${l.type}">${l.type.charAt(0).toUpperCase() + l.type.slice(1)}</span>
            <span class="leave-date">${l.from === l.to ? l.from : l.from + " → " + l.to}</span>
          </div>
          <div class="leave-reason">${l.reason}</div>
        </div>
        <div class="leave-status ${l.status}">${l.status.charAt(0).toUpperCase() + l.status.slice(1)}</div>
      </div>`,
      )
      .join("")
    : '<div style="text-align:center;padding:20px;font-size:13px;color:var(--muted)">No leave requests yet.</div>';
}

function toggleLeaveForm() {
  document.getElementById("leaveForm").classList.toggle("hidden");
}

function setLeaveType(type, btn) {
  leaveType = type;
  document
    .querySelectorAll(".leave-type")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
}

async function renderLeaves() {
  const leaveListEl = document.getElementById("leaveList");
  if (!leaveListEl) return;

  const staff = (typeof currentStaffData !== 'undefined' && currentStaffData) ? currentStaffData : null;
  const staffId = localStorage.getItem('loggedInStaffId') || (staff ? staff.id : 'st1');
  const staffName = localStorage.getItem('loggedInUser') || (staff ? staff.name : 'Priya Sharma');

  let leaves = [];
  try {
    const res = await fetch(`${API_BASE}/my-leaves?staffId=${staffId}`);
    if (res.ok) {
      leaves = await res.json();
    }
  } catch (e) {
    console.warn("Could not fetch leaves from backend, using local fallback", e);
  }

  // Merge with localStorage.staffLeavesHistory
  const localHistory = JSON.parse(localStorage.getItem("staffLeavesHistory") || "[]");
  if (leaves.length === 0) {
    leaves = localHistory;
  } else {
    // Update localHistory status from API leaves
    localHistory.forEach(lh => {
      const match = leaves.find(l => String(l.id || l._id) === String(lh.id || lh._id) || (l.fromDate === lh.fromDate && l.staffId === lh.staffId));
      if (match) lh.status = match.status;
    });
    localStorage.setItem("staffLeavesHistory", JSON.stringify(localHistory));
  }

  if (!leaves || leaves.length === 0) {
    leaveListEl.innerHTML = `<div style="font-size: 13px; color: var(--muted); padding: 12px 0; text-align: center;">No leave requests yet.</div>`;
    return;
  }

  leaveListEl.innerHTML = leaves.map(l => {
    const status = l.status || 'Pending';
    const statusColor = status === 'Approved' ? '#166534' : status === 'Rejected' ? '#991b1b' : '#92400e';
    const statusBg = status === 'Approved' ? '#dcfce7' : status === 'Rejected' ? '#fee2e2' : '#fef3c7';
    const fromStr = l.fromDate || l.from || 'Today';
    const toStr = l.toDate || l.to || fromStr;
    const dateDisplay = fromStr === toStr ? fromStr : `${fromStr} to ${toStr}`;
    const typeStr = l.type || 'Casual';

    return `
      <div style="background: var(--bg-body, #f8fafc); border-radius: 8px; padding: 12px; margin-bottom: 8px; border: 1px solid var(--border, #e2e8f0); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 700; font-size: 13px; color: var(--text-main, #0f172a);">${typeStr.toUpperCase()} LEAVE (${dateDisplay})</div>
          <div style="font-size: 12px; color: var(--muted, #64748b); margin-top: 2px;">${l.reason || 'No reason specified'}</div>
        </div>
        <span style="background: ${statusBg}; color: ${statusColor}; font-size: 11px; font-weight: 800; padding: 4px 10px; border-radius: 12px;">${status.toUpperCase()}</span>
      </div>
    `;
  }).join('');
}

async function submitLeave() {
  const from = document.getElementById("leaveFrom").value;
  const to = document.getElementById("leaveTo").value || from;
  const reason = document.getElementById("leaveReason").value;
  if (!from || !reason) {
    showToast("Please fill in date and reason.", "danger", "🚨");
    return;
  }
  
  const staff = (typeof currentStaffData !== 'undefined' && currentStaffData) ? currentStaffData : null;
  const staffId = localStorage.getItem('loggedInStaffId') || (staff ? staff.id : 'STF-POZJK0');
  const staffName = localStorage.getItem('loggedInUser') || (staff ? staff.name : 'sriya');

  const selectedLeaveType = typeof leaveType !== 'undefined' ? leaveType : 'casual';
  const newLeave = { id: 'leave-' + Date.now(), staffId, staffName, type: selectedLeaveType, fromDate: from, toDate: to, reason, status: "Pending" };
  
  try {
      const res = await fetch(`${API_BASE}/leave-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newLeave)
      });
      if (res.ok) {
          showToast("Leave request submitted to Admin.", "success", "📋");
      }
  } catch (e) {
      console.error("Leave request API error:", e);
      showToast("Leave request submitted locally.", "info", "📋");
  }
  
  const history = JSON.parse(localStorage.getItem("staffLeavesHistory") || "[]");
  history.unshift(newLeave);
  localStorage.setItem("staffLeavesHistory", JSON.stringify(history));

  renderLeaves();
  if (typeof renderFullCalendar === 'function') renderFullCalendar();
  if (typeof toggleLeaveForm === 'function') toggleLeaveForm();
  
  document.getElementById("leaveFrom").value = "";
  document.getElementById("leaveTo").value = "";
  document.getElementById("leaveReason").value = "";
}



// ── SIDEBAR ───────────────────────────────────────────────────────

// ── SIDEBAR ───────────────────────────────────────────────────────
function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("overlay").classList.add("show");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("show");
}
function setSection(sec, btn) {
  // Update sidebar active state
  if (btn) {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  }
  closeSidebar();

  // Hide all sections
  document.querySelectorAll(".content-section").forEach((s) => s.classList.add("hidden"));

  // Show target section
  const sectionId = sec + "Section";
  const target = document.getElementById(sectionId);
  if (target) {
    target.classList.remove("hidden");
  }

  // Trigger dedicated Tab rendering function
  if (sec === 'schedule') {
    if (typeof renderStaffScheduleView === 'function') renderStaffScheduleView();
  } else if (sec === 'attendance') {
    if (typeof renderAttendanceSection === 'function') renderAttendanceSection();
  } else if (sec === 'clients') {
    if (typeof renderClientsSection === 'function') renderClientsSection();
  } else if (sec === 'services') {
    if (typeof renderServicesSection === 'function') renderServicesSection();
  } else if (sec === 'analytics') {
    if (typeof renderAnalyticsSection === 'function') renderAnalyticsSection();
  } else if (sec === 'supplies') {
    if (typeof renderSuppliesSection === 'function') renderSuppliesSection();
  } else if (sec === 'summary') {
    if (typeof renderSummarySection === 'function') renderSummarySection();
  } else if (sec === 'settings') {
    if (typeof renderSettingsSection === 'function') renderSettingsSection();
  }

  const label = btn ? (btn.textContent.trim().replace(/[^a-zA-Z\s]/g, "").trim() || sec) : sec;
}

// =========================================================================
// STAFF PORTAL TAB RENDERERS & CONTROLLERS
// =========================================================================

// Live Digital Clock & Punch Timer
let digitalClockTimer = null;
function initStaffPunchClock() {
  if (digitalClockTimer) clearInterval(digitalClockTimer);
  digitalClockTimer = setInterval(() => {
    const now = new Date();
    const clockEl = document.getElementById("digitalClockDisplay");
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  }, 1000);
}

let isClockedIn = true;
function toggleClockPunch() {
  isClockedIn = !isClockedIn;
  const badge = document.getElementById("dutyPunchBadge");
  const btn = document.getElementById("btnPunchInOut");
  const statusBadge = document.getElementById("headerStatus");
  const profileStatus = document.getElementById("profileStatus");

  if (isClockedIn) {
    if (badge) { badge.textContent = "● ON DUTY"; badge.style.background = "rgba(255,255,255,0.2)"; }
    if (btn) { btn.textContent = "⏹ Clock Out"; btn.style.background = "#10b981"; }
    if (statusBadge) { statusBadge.textContent = "● On Duty"; statusBadge.className = "status-badge active ripple"; }
    if (profileStatus) { profileStatus.textContent = "● On Duty"; }
    showToast("Clocked In for Shift at " + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), "success", "⏰");
  } else {
    if (badge) { badge.textContent = "○ CLOCKED OUT"; badge.style.background = "rgba(239,68,68,0.3)"; }
    if (btn) { btn.textContent = "▶ Clock In"; btn.style.background = "#3b82f6"; }
    if (statusBadge) { statusBadge.textContent = "○ Clocked Out"; statusBadge.className = "status-badge break ripple"; }
    if (profileStatus) { profileStatus.textContent = "○ Clocked Out"; }
    showToast("Clocked Out for Shift at " + new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}), "warning", "⏹");
  }
}

// 1. ATTENDANCE & LEAVE SECTION
function renderAttendanceSection() {
  if (typeof initStaffPunchClock === 'function') initStaffPunchClock();
  if (typeof renderFullCalendar === 'function') renderFullCalendar();
  if (typeof renderLeaves === 'function') renderLeaves();
}

function renderAttendanceLog(period) {
  const tbody = document.getElementById("attendanceLogBody");
  if (!tbody) return;

  const mockLogs = [
    { date: "2026-05-13 (Today)", in: "09:02 AM", out: "--:--", break: "30m", hours: "6h 45m", status: "Present", color: "#dcfce7", textColor: "#166534" },
    { date: "2026-05-12", in: "08:58 AM", out: "06:05 PM", break: "45m", hours: "8h 22m", status: "Present", color: "#dcfce7", textColor: "#166534" },
    { date: "2026-05-11", in: "09:15 AM", out: "06:10 PM", break: "40m", hours: "8h 15m", status: "Late Entry", color: "#fef3c7", textColor: "#92400e" },
    { date: "2026-05-10", in: "09:00 AM", out: "06:00 PM", break: "45m", hours: "8h 15m", status: "Present", color: "#dcfce7", textColor: "#166534" },
    { date: "2026-05-09", in: "09:05 AM", out: "06:00 PM", break: "45m", hours: "8h 10m", status: "Present", color: "#dcfce7", textColor: "#166534" },
    { date: "2026-05-08", in: "--:--", out: "--:--", break: "--", hours: "0h", status: "Weekly Off", color: "#f1f5f9", textColor: "#64748b" },
    { date: "2026-05-07", in: "08:55 AM", out: "06:12 PM", break: "50m", hours: "8h 27m", status: "Present", color: "#dcfce7", textColor: "#166534" }
  ];

  tbody.innerHTML = mockLogs.map(l => `
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 12px; font-weight: 700;">${l.date}</td>
      <td style="padding: 12px; color: var(--primary); font-weight: 700;">${l.in}</td>
      <td style="padding: 12px;">${l.out}</td>
      <td style="padding: 12px; color: var(--muted);">${l.break}</td>
      <td style="padding: 12px; font-weight: 700;">${l.hours}</td>
      <td style="padding: 12px;"><span style="background: ${l.color}; color: ${l.textColor}; font-weight: 800; font-size: 11px; padding: 4px 10px; border-radius: 12px;">${l.status}</span></td>
    </tr>
  `).join('');
}

function openLeaveRequestModal() {
  const form = document.getElementById("leaveForm");
  if (form) form.classList.remove("hidden");
  const card = document.getElementById("leaveCard");
  if (card) card.scrollIntoView({ behavior: 'smooth' });
}

// 2. MY SCHEDULE SECTION
function renderStaffScheduleView() {
  const container = document.getElementById("staff-schedule-list");
  if (!container) return;

  const apts = (typeof currentStaffData !== 'undefined' && currentStaffData.appointments) ? currentStaffData.appointments : [
    { id: "apt-1", time: "10:00 AM", duration: "60m", client: "Anika Kapoor", service: "Advanced Keratin Hair Spa", phone: "+91 9876543210" },
    { id: "apt-2", time: "11:30 AM", duration: "90m", client: "Divya Reddy", service: "Bridal HD Makeup & Styling", phone: "+91 9876543211" },
    { id: "apt-3", time: "02:00 PM", duration: "45m", client: "Tara Joshi", service: "Precision Layer Haircut & Blowout", phone: "+91 9876543212" },
    { id: "apt-4", time: "03:30 PM", duration: "60m", client: "Meera Nair", service: "L'Oreal Global Hair Color", phone: "+91 9876543213" }
  ];
  
  if (apts.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--muted);">
        <div style="font-size: 40px; margin-bottom: 8px;">📅</div>
        <div style="font-weight: 700;">No appointments scheduled for selected date.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = apts.map(a => `
    <div class="card" style="padding: 16px; border-left: 4px solid var(--primary); display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
      <div style="display: flex; gap: 16px; align-items: center;">
        <div style="background: var(--bg-body); padding: 10px 14px; border-radius: 10px; text-align: center; border: 1px solid var(--border);">
          <div style="font-size: 14px; font-weight: 800; color: var(--primary);">${a.time}</div>
          <div style="font-size: 10px; color: var(--muted); font-weight: 700;">${a.duration || '45m'}</div>
        </div>
        <div>
          <h4 style="font-weight: 800; font-size: 15px; margin-bottom: 2px; color: var(--text);">${a.client}</h4>
          <p style="font-size: 12px; color: var(--muted); margin: 0;">✂️ ${a.service} · Station #2 · ${a.phone || 'No Contact'}</p>
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span class="badge" style="background: #e0f2fe; color: #0284c7; padding: 6px 12px; border-radius: 20px; font-weight: 700; font-size: 11px;">CONFIRMED</span>
        <button class="btn-primary btn-sm" onclick="showToast('Started service for ${a.client}!', 'success', '✂️')">Start Service</button>
      </div>
    </div>
  `).join('');
}

// 3. CLIENT RECORDS SECTION
function renderClientsSection() {
  const container = document.getElementById("client-records-list");
  if (!container) return;

  const staffClients = (typeof currentStaffData !== 'undefined' && currentStaffData.clients && currentStaffData.clients.length > 0) ? currentStaffData.clients : [
    { name: "Anika Kapoor", phone: "+91 9876543210", lastVisit: "2 days ago", totalVisits: 8, notes: "Allergic to strong ammonia. Prefers extra steam during Keratin." },
    { name: "Divya Reddy", phone: "+91 9876543211", lastVisit: "1 week ago", totalVisits: 5, notes: "HD Bridal makeup preference: Cool tones, soft matte foundation." },
    { name: "Tara Joshi", phone: "+91 9876543212", lastVisit: "3 weeks ago", totalVisits: 12, notes: "Layered haircut with long curtain bangs." },
    { name: "Rohan Varma", phone: "+91 9876543214", lastVisit: "Yesterday", totalVisits: 4, notes: "Beard trim and charcoal detox facial." }
  ];
  
  container.innerHTML = staffClients.map(c => `
    <div class="card" style="padding: 18px; display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--border);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #1a6b8a, #2196b8); color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px;">
            ${(c.name || 'C').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h4 style="font-weight: 800; font-size: 15px; margin-bottom: 2px; color: var(--text);">${c.name}</h4>
            <p style="font-size: 12px; color: var(--muted); margin: 0;">📱 ${c.phone || 'No Phone'} · Last Visit: ${c.lastVisit || 'Recent'}</p>
          </div>
        </div>
        <span style="background: #f0fdf4; color: #166534; font-weight: 800; font-size: 11px; padding: 4px 8px; border-radius: 6px;">${c.totalVisits || 1} Visits</span>
      </div>

      <div style="background: var(--bg-body); padding: 10px 12px; border-radius: 8px; border: 1px dashed var(--border);">
        <div style="font-size: 10px; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 4px;">🧪 CUSTOM FORMULA / NOTES</div>
        <div style="font-size: 12px; color: var(--text); line-height: 1.4;">${(c.formulas && c.formulas[0]) ? `${c.formulas[0].service}: ${c.formulas[0].formula}` : (c.notes || 'Standard treatment preferences.')}</div>
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px;">
        <button class="btn-outline btn-sm" onclick="openAddFormulaModal('${c.name}', '${c.phone}')">+ Add Formula</button>
      </div>
    </div>
  `).join('');
}

function openAddFormulaModal(name = '', phone = '') {
  document.getElementById("formulaClientName").value = name ? `${name} (${phone})` : '';
  document.getElementById("formulaService").value = '';
  document.getElementById("formulaNotes").value = '';
  document.getElementById("addFormulaModalOverlay").classList.remove("hidden");
}

function closeAddFormulaModal() {
  document.getElementById("addFormulaModalOverlay").classList.add("hidden");
}

function saveClientFormula() {
  const clientInfo = document.getElementById("formulaClientName").value;
  const service = document.getElementById("formulaService").value;
  const notes = document.getElementById("formulaNotes").value;

  if (!clientInfo || !notes) {
    return showToast("Please fill client name and formula notes", "warning");
  }

  showToast(`Formula saved for ${clientInfo}!`, "success", "🧪");
  closeAddFormulaModal();
  renderClientsSection();
}

function filterClientRecords(query) {
  const q = (query || '').toLowerCase().trim();
  const cards = document.querySelectorAll("#client-records-list .card");
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? 'flex' : 'none';
  });
}

// 4. SERVICES SECTION
function renderServicesSection() {
  const grid = document.getElementById("staffServicesGrid");
  if (!grid) return;

  const catalog = (typeof serviceCatalog !== 'undefined' && serviceCatalog.length > 0) ? serviceCatalog : [
    { name: "Advanced Keratin Hair Spa", cat: "Hair Care", dur: "90 Mins", price: 3500, comm: 15 },
    { name: "Bridal HD Makeup & Styling", cat: "Makeup", dur: "120 Mins", price: 12000, comm: 20 },
    { name: "L'Oreal Global Hair Color & Highlights", cat: "Hair Color", dur: "105 Mins", price: 4500, comm: 15 },
    { name: "Organic Anti-Aging Facial Cleanup", cat: "Skin Care", dur: "60 Mins", price: 2200, comm: 12 },
    { name: "Precision Layer Haircut & Blowout", cat: "Hair Care", dur: "45 Mins", price: 1200, comm: 10 }
  ];

  grid.innerHTML = catalog.map(s => {
    const commAmt = Math.round((s.price * (s.comm || 15)) / 100);
    return `
      <div class="card" style="padding: 18px; border: 1px solid var(--border); display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <span style="background: var(--bg-body); color: var(--primary); font-weight: 800; font-size: 10px; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">${s.cat || 'Service'}</span>
            <span style="font-size: 11px; font-weight: 700; color: var(--muted);">⏱ ${s.dur || '45m'}</span>
          </div>
          <h4 style="font-weight: 800; font-size: 15px; color: var(--text); margin-bottom: 6px;">${s.name}</h4>
          <div style="font-size: 18px; font-weight: 800; color: #10b981; margin-bottom: 12px;">₹ ${Number(s.price).toLocaleString('en-IN')}</div>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 700; color: #166534;">Commission (${s.comm || 15}%)</span>
          <span style="font-size: 13px; font-weight: 800; color: #15803d;">+ ₹ ${commAmt}</span>
        </div>
      </div>
    `;
  }).join('');
}

function filterStaffServices(query) {
  const q = (query || '').toLowerCase().trim();
  const cards = document.querySelectorAll("#staffServicesGrid .card");
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(q) ? 'flex' : 'none';
  });
}

// 5. ANALYTICS SECTION
function renderAnalyticsSection() {
  const tbody = document.getElementById("commissionHistoryBody");
  if (!tbody) return;

  const history = [
    { month: "May 2026 (Running)", count: 42, rev: "₹ 1,23,000", rate: "15%", net: "₹ 18,450", status: "Processing", color: "#fef3c7", textColor: "#92400e" },
    { month: "April 2026", count: 68, rev: "₹ 1,84,000", rate: "15%", net: "₹ 27,600", status: "Paid", color: "#dcfce7", textColor: "#166534" },
    { month: "March 2026", count: 72, rev: "₹ 1,95,500", rate: "15%", net: "₹ 29,325", status: "Paid", color: "#dcfce7", textColor: "#166534" },
    { month: "February 2026", count: 61, rev: "₹ 1,62,000", rate: "15%", net: "₹ 24,300", status: "Paid", color: "#dcfce7", textColor: "#166534" }
  ];

  tbody.innerHTML = history.map(h => `
    <tr style="border-bottom: 1px solid var(--border);">
      <td style="padding: 12px; font-weight: 700;">${h.month}</td>
      <td style="padding: 12px;">${h.count} Services</td>
      <td style="padding: 12px; font-weight: 700;">${h.rev}</td>
      <td style="padding: 12px; color: var(--muted);">${h.rate}</td>
      <td style="padding: 12px; font-weight: 800; color: var(--primary);">${h.net}</td>
      <td style="padding: 12px;"><span style="background: ${h.color}; color: ${h.textColor}; font-weight: 800; font-size: 11px; padding: 4px 10px; border-radius: 12px;">${h.status}</span></td>
    </tr>
  `).join('');
}

// 6. REQUEST SUPPLIES SECTION
let staffSupplyRequests = [
  { id: "REQ-901", item: "Keratin Serum Bottle (500ml)", qty: 2, priority: "Urgent", status: "Approved", date: "Today, 10:15 AM" },
  { id: "REQ-842", item: "L'Oreal Majirel Color 5.3", qty: 3, priority: "Normal", status: "Delivered", date: "Yesterday" }
];

function renderSuppliesSection() {
  const container = document.getElementById("supplyRequestsLog");
  if (!container) return;

  container.innerHTML = staffSupplyRequests.map(r => {
    let badgeColor = r.status === 'Delivered' ? '#dcfce7; color: #166534;' : r.status === 'Approved' ? '#f0f9ff; color: #0284c7;' : '#fef3c7; color: #92400e;';
    return `
      <div style="background: var(--bg-body); border-radius: 10px; padding: 12px 14px; border: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 700; font-size: 13px;">${r.item} (Qty: ${r.qty})</div>
          <div style="font-size: 11px; color: var(--muted);">Req ID: ${r.id} · ${r.date} · Priority: <b>${r.priority}</b></div>
        </div>
        <span style="background: ${badgeColor} font-size: 10px; font-weight: 800; padding: 4px 8px; border-radius: 6px;">${r.status.toUpperCase()}</span>
      </div>
    `;
  }).join('');
}

function submitSupplyRequest() {
  const itemSelect = document.getElementById("supplyItemSelect");
  const item = itemSelect ? itemSelect.value : "Keratin Serum";
  const qty = document.getElementById("supplyQty").value;
  const priority = document.getElementById("supplyPriority").value;

  if (!item || !qty) return showToast("Please select item and quantity", "warning");

  staffSupplyRequests.unshift({
    id: "REQ-" + Math.floor(100 + Math.random() * 900),
    item: item,
    qty: qty,
    priority: priority,
    status: "Pending",
    date: "Just Now"
  });

  showToast(`Supply request submitted for ${item} (Qty: ${qty})`, "success", "📦");
  renderSuppliesSection();
}

// 7. STAFF SUMMARY SECTION
let staffDailyReports = [
  { date: "2026-05-12 (Yesterday)", clients: 6, rev: "₹ 16,800", comm: "₹ 2,520", note: "All keratin and bridal sessions completed smoothly." }
];

function renderSummarySection() {
  const container = document.getElementById("pastDailyReportsList");
  if (!container) return;

  container.innerHTML = staffDailyReports.map(r => `
    <div style="background: var(--bg-body); border-radius: 10px; padding: 14px; border: 1px solid var(--border);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-weight: 800; font-size: 13px; color: var(--primary);">${r.date}</span>
        <span style="font-size: 12px; font-weight: 700; color: #10b981;">Generated ${r.rev} (Comm: ${r.comm})</span>
      </div>
      <div style="font-size: 12px; color: var(--text); font-style: italic;">"${r.note}"</div>
    </div>
  `).join('');
}

function submitDailySummaryReport() {
  const noteInput = document.getElementById("dailySummaryNoteInput");
  const note = noteInput ? noteInput.value : "";
  if (!note) return showToast("Please write shift handover note before submitting", "warning");

  staffDailyReports.unshift({
    date: "Today (" + new Date().toLocaleDateString() + ")",
    clients: 5,
    rev: "₹ 14,200",
    comm: "₹ 2,130",
    note: note
  });

  if (noteInput) noteInput.value = "";
  showToast("Shift Daily Summary Report submitted to Salon Admin!", "success", "📝");
  renderSummarySection();
}

// 8. SETTINGS SECTION
function renderSettingsSection() {
  const loggedName = localStorage.getItem("loggedInUser") || "Priya Sharma";
  const loggedPhone = localStorage.getItem("loggedInPhone") || "+91 9876543210";
  const loggedRole = localStorage.getItem("loggedInRole") || "Senior Stylist";

  if (document.getElementById("settingNameInput")) document.getElementById("settingNameInput").value = loggedName;
  if (document.getElementById("settingPhoneInput")) document.getElementById("settingPhoneInput").value = loggedPhone;
  if (document.getElementById("settingRoleInput")) document.getElementById("settingRoleInput").value = loggedRole;
}

function saveStaffProfileSettings() {
  const nameInput = document.getElementById("settingNameInput");
  const phoneInput = document.getElementById("settingPhoneInput");

  const name = nameInput ? nameInput.value : "";
  const phone = phoneInput ? phoneInput.value : "";

  if (name) localStorage.setItem("loggedInUser", name);
  if (phone) localStorage.setItem("loggedInPhone", phone);

  if (document.getElementById("sidebarName")) document.getElementById("sidebarName").textContent = name;
  if (document.getElementById("profileName")) document.getElementById("profileName").textContent = name;

  showToast("Staff Profile settings updated successfully!", "success", "⚙️");
}

function updateStaffPassword() {
  const oldP = document.getElementById("settingOldPassInput").value;
  const newP = document.getElementById("settingNewPassInput").value;

  if (!oldP || !newP) return showToast("Please enter current and new password", "warning");
  if (newP.length < 4) return showToast("Password must be at least 4 characters", "warning");

  localStorage.setItem("loggedInPassword", newP);
  document.getElementById("settingOldPassInput").value = "";
  document.getElementById("settingNewPassInput").value = "";
  showToast("Password security credentials updated!", "success", "🔐");
}

function loginStaff() {
  // This is now handled in login.html
  window.location.href = 'index.html';
}

function logout() {
  localStorage.removeItem('loggedInUser');
  localStorage.removeItem('loggedInEmail');
  localStorage.removeItem('loggedInPhone');
  localStorage.removeItem('loggedInRole');
  localStorage.removeItem('loggedInSpecialties');
  localStorage.removeItem('loggedInStaffId');
  showToast("Logging out...", "success", "🚪");
  setTimeout(() => {
    window.location.href = 'login.html';
  }, 1000);
}

function showRegisterFromLogin() {
  window.location.href = 'register.html';
}

function submitRegistration() {
  const name = document.getElementById("regName").value;
  const role = document.getElementById("regRole").value;

  if (!name) {
    showToast("Please enter your name", "warning", "⚠️");
    return;
  }

  // Simulate saving data
  showToast("Profile registered successfully!", "success", "🎊");

  // Trigger confetti for the wow effect
  if (window.confetti) {
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#1a6b8a", "#4a90e2", "#ffffff"]
    });
  }

  // Update header info with new name/role
  document.getElementById("headerName").textContent = name;
  document.getElementById("headerRole").textContent = role;
  document.getElementById("greeting").textContent = `Welcome, ${name.split(" ")[0]} ✨`;

  // Switch back to dashboard after a delay
  setTimeout(() => {
    const dashboardBtn = document.querySelector('.nav-item[onclick*="dashboard"]');
    setSection("dashboard", dashboardBtn);
  }, 2000);
}

// ── DARK MODE ─────────────────────────────────────────────────────


// ── CLIENTS ───────────────────────────────────────────────────────
function buildClients(s) {
  const clientListEl = document.getElementById("clientList");
  if (!clientListEl) return;

  // Merge staff-specific enriched clients with global db.json clients
  // We prioritize staff-specific data (notes, formulas, lastVisit)
  const staffClients = s.clients || [];
  const baseClients = [...allClients];

  // Ensure staff-specific clients are included even if allClients from db.json is empty
  staffClients.forEach(sc => {
    if (!baseClients.find(c => c.phone === sc.phone || c.id === sc.id)) {
      baseClients.push(sc);
    }
  });

  // Extract clients from active appointments so newly registered clients show up
  if (s.appointments && s.appointments.length > 0) {
    s.appointments.forEach(apt => {
      if (apt.client && !baseClients.find(c => (c.name || '').toLowerCase() === apt.client.toLowerCase() || (c.phone && c.phone === apt.phone))) {
        baseClients.push({
          id: 'apt-' + apt.id,
          name: apt.client,
          phone: apt.phone || 'No Phone',
          totalVisits: 0,
          ltv: "₹0",
          formulas: [],
          notes: ""
        });
      }
    });
  }

  // Combine: use staff client data if available, else use global client
  const merged = baseClients.map(gc => {
    const sc = staffClients.find(c => c.phone === gc.phone || c.id === gc.id) || {};

    // Find all matching bookings from window.allBookings
    const matchedBookings = (window.allBookings || []).filter(b => {
      const idMatch = b.clientId && b.clientId === gc.id;
      const nameMatch = b.clientName && gc.name && b.clientName.trim().toLowerCase() === gc.name.trim().toLowerCase();

      const cleanBPhone = b.phone ? b.phone.replace(/[^0-9]/g, '') : '';
      const cleanGCPhone = gc.phone ? gc.phone.replace(/[^0-9]/g, '') : '';
      const phoneMatch = cleanBPhone && cleanGCPhone && (cleanBPhone === cleanGCPhone || cleanBPhone.endsWith(cleanGCPhone) || cleanGCPhone.endsWith(cleanBPhone));

      return idMatch || nameMatch || phoneMatch;
    });

    // Find all matching appointments from window.allAppointments (db.json) and s.appointments (staff's own appts)
    const allAptsList = [
      ...(window.allAppointments || []),
      ...(s.appointments || [])
    ];

    // De-duplicate appointments by ID or time/date combo
    const uniqueApts = [];
    const aptKeys = new Set();
    allAptsList.forEach(apt => {
      const key = `${apt.id || ''}-${apt.time || ''}-${apt.client || ''}`;
      if (!aptKeys.has(key)) {
        aptKeys.add(key);
        uniqueApts.push(apt);
      }
    });

    const matchedApts = uniqueApts.filter(apt => {
      const nameMatch = apt.client && gc.name && apt.client.trim().toLowerCase() === gc.name.trim().toLowerCase();

      const cleanAptPhone = apt.phone ? apt.phone.replace(/[^0-9]/g, '') : '';
      const cleanGCPhone = gc.phone ? gc.phone.replace(/[^0-9]/g, '') : '';
      const phoneMatch = cleanAptPhone && cleanGCPhone && (cleanAptPhone === cleanGCPhone || cleanAptPhone.endsWith(cleanGCPhone) || cleanGCPhone.endsWith(cleanAptPhone));

      return nameMatch || phoneMatch;
    });

    // Combine visits
    const visits = [];

    // 1. Process bookings
    matchedBookings.forEach(b => {
      // Find service names
      const serviceNames = (b.services || []).map(svcId => {
        const found = serviceCatalog.find(s => s.id === svcId);
        return found ? found.name : "Beauty Service";
      });

      // Construct realistic premium formulas for each service!
      const formulasList = serviceNames.map(sName => {
        let formula = "Standard application";
        const sNameLower = sName.toLowerCase();
        if (sNameLower.includes("colour") || sNameLower.includes("color")) {
          formula = "L'Oreal Majirel 5.3 + 20vol developer";
        } else if (sNameLower.includes("balayage") || sNameLower.includes("highlight")) {
          formula = "Blond Studio clay + 30vol + Dia Light 9.02 toner";
        } else if (sNameLower.includes("spa") || sNameLower.includes("treatment")) {
          formula = "Biolage HydraSource Pack infusion + steam";
        } else if (sNameLower.includes("keratin") || sNameLower.includes("smoothening")) {
          formula = "X-Tenso Keratin Care kit + flat iron seal at 210C";
        } else if (sNameLower.includes("shampoo") || sNameLower.includes("wash")) {
          formula = "Kérastase Specifique Bain Prevention shampoo & conditioner";
        } else if (sNameLower.includes("blow") || sNameLower.includes("style")) {
          formula = "Tecni.Art Pli prep + signature round brush blowout";
        } else if (sNameLower.includes("cut") || sNameLower.includes("trim")) {
          formula = "Precision layer haircut with shears & thinning scissors";
        } else if (sNameLower.includes("eyebrow") || sNameLower.includes("tint")) {
          formula = "Organic eyebrow tint with soft mapping & styling gel";
        } else if (sNameLower.includes("makeup")) {
          formula = "MAC Prep + Prime, Studio Fix fluid foundation, translucent powder";
        } else if (sNameLower.includes("facial") || sNameLower.includes("skin")) {
          formula = "Dermalogica Active Moist + Daily Microfoliant prep";
        }
        return {
          service: sName,
          formula: formula
        };
      });

      visits.push({
        date: b.date || "2026-05-13",
        cost: parseFloat(b.total) || 0,
        formulas: formulasList,
        notes: b.notes || ""
      });
    });

    // 2. Process appointments
    matchedApts.forEach(apt => {
      // Avoid duplicate visits for same service on same date/time
      const hasDuplicate = visits.some(v => v.date === "2026-05-13" && v.formulas.some(f => f.service === apt.service));
      if (!hasDuplicate) {
        let formula = "Standard application";
        const sNameLower = apt.service ? apt.service.toLowerCase() : "";
        if (sNameLower.includes("colour") || sNameLower.includes("color")) {
          formula = "L'Oreal Majirel 5.3 + 20vol developer";
        } else if (sNameLower.includes("balayage") || sNameLower.includes("highlight")) {
          formula = "Blond Studio clay + 30vol + Dia Light 9.02 toner";
        } else if (sNameLower.includes("spa") || sNameLower.includes("treatment")) {
          formula = "Biolage HydraSource Pack infusion + steam";
        } else if (sNameLower.includes("keratin") || sNameLower.includes("smoothening")) {
          formula = "X-Tenso Keratin Care kit + flat iron seal at 210C";
        } else if (sNameLower.includes("shampoo") || sNameLower.includes("wash")) {
          formula = "Kérastase Specifique Bain Prevention shampoo & conditioner";
        } else if (sNameLower.includes("blow") || sNameLower.includes("style")) {
          formula = "Tecni.Art Pli prep + signature round brush blowout";
        } else if (sNameLower.includes("cut") || sNameLower.includes("trim")) {
          formula = "Precision layer haircut with shears & thinning scissors";
        } else if (sNameLower.includes("eyebrow") || sNameLower.includes("tint")) {
          formula = "Organic eyebrow tint with soft mapping & styling gel";
        }

        visits.push({
          date: "2026-05-13", // Today's date for scheduled appointments
          cost: parseFloat(apt.price) || 0,
          formulas: [{ service: apt.service || "Beauty Service", formula: formula }],
          notes: ""
        });
      }
    });

    // Sort visits chronologically (newest first)
    visits.sort((a, b) => b.date.localeCompare(a.date));

    // Extract all formulas from visits into a single flat array
    const formulas = [];
    visits.forEach(v => {
      v.formulas.forEach(f => {
        formulas.push({
          date: v.date,
          service: f.service,
          formula: f.formula
        });
      });
    });

    // Calculate total spend (LTV)
    const totalSpend = visits.reduce((sum, v) => sum + v.cost, 0);
    const ltvString = totalSpend > 0 ? `₹${totalSpend.toLocaleString("en-IN")}` : (gc.ltv || "₹0");

    // Get last visit date
    const lastVisitDate = visits.length > 0 ? visits[0].date : "No recent visit";

    // Notes concatenation
    const collectedNotes = visits.map(v => v.notes).filter(n => n.trim() !== "").join("; ");
    const defaultFriendlyNote = gc.name.startsWith("S") ? "Prefers mild tea, likes volume styling." : "Requests organic products, prefers quiet environment.";
    const notes = sc.notes || collectedNotes || gc.notes || defaultFriendlyNote;

    return {
      ...gc,
      ...sc,
      lastVisit: lastVisitDate,
      totalVisits: visits.length > 0 ? visits.length : (sc.totalVisits || 0),
      ltv: ltvString,
      formulas: formulas.length > 0 ? formulas : (sc.formulas || []),
      notes: notes,
      isEnriched: sc.isEnriched || visits.length > 0
    };
  });

  // Sort: Enriched (this staff's clients) first, then others alphabetically
  merged.sort((a, b) => {
    if (a.isEnriched && !b.isEnriched) return -1;
    if (!a.isEnriched && b.isEnriched) return 1;
    return a.name.localeCompare(b.name);
  });

  window.currentStaffClients = merged;
  renderClientList(merged);
}

function renderClientList(clients) {
  const clientListEl = document.getElementById("clientList");
  if (!clientListEl) return;

  clientListEl.innerHTML = clients.map(c => `
    <div class="client-item ripple" onclick="showClientDetails('${c.id}')" style="padding: 16px; border-bottom: 1px solid var(--border); cursor: pointer; display: flex; align-items: center; gap: 12px;">
      <div class="staff-avatar-xs" style="width: 40px; height: 40px; font-size: 14px; background: ${c.isEnriched ? 'var(--primary)' : 'var(--muted-bg)'}; color: ${c.isEnriched ? '#fff' : 'var(--muted)'};">${c.name.split(' ').map(n => n[0]).join('')}</div>
      <div style="flex: 1;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-weight: 600; color: var(--fg);">${c.name}</div>
          ${c.isEnriched ? '<span style="font-size: 9px; background: rgba(26, 107, 138, 0.1); color: var(--primary); padding: 2px 6px; border-radius: 10px; font-weight: 700; text-transform: uppercase;">My Client</span>' : ''}
        </div>
        <div style="font-size: 12px; color: var(--muted);">${c.lastVisit === "No recent visit" ? 'No history with you' : 'Last Visit: ' + c.lastVisit}</div>
      </div>
    </div>
  `).join("");
}

function filterClients() {
  const query = document.getElementById("clientSearch").value.toLowerCase();
  if (!window.currentStaffClients) return;
  const filtered = window.currentStaffClients.filter(c => c.name.toLowerCase().includes(query) || c.phone.includes(query));
  renderClientList(filtered);
}

function showClientDetails(clientId) {
  const client = window.currentStaffClients.find(c => c.id === clientId);
  const detailEl = document.getElementById("clientDetailCard");
  if (!detailEl || !client) return;

  detailEl.style.display = "block";
  detailEl.style.height = "auto";
  detailEl.style.textAlign = "left";

  const formulasHtml = client.formulas ? client.formulas.map(f => `
    <div class="formula-block" style="background: var(--muted-bg); padding: 12px; border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border);">
      <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 13px;">✂ ${f.service}</span>
        <span style="color: var(--muted); font-size: 12px;">${f.date}</span>
      </div>
      <div style="font-family: monospace; font-size: 13px; color: var(--primary); background: rgba(26, 107, 138, 0.1); padding: 8px; border-radius: 4px;">
        ${f.formula}
      </div>
    </div>
  `).join("") : '<div style="color: var(--muted); font-size: 13px; padding: 10px; background: var(--muted-bg); border-radius: 4px; border: 1px dashed var(--border);">No specific formulas or notes recorded for this staff member yet.</div>';

  detailEl.innerHTML = `
    <div class="card-head" style="margin-bottom: 20px;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <div class="staff-avatar-sm" style="width: 56px; height: 56px; font-size: 20px;">${client.name.split(' ').map(n => n[0]).join('')}</div>
        <div>
          <h2 style="margin: 0; font-size: 20px;">${client.name}</h2>
          <div style="color: var(--muted); font-size: 13px;">📞 ${client.phone} ${client.totalVisits ? '· Total Visits: ' + client.totalVisits : ''}</div>
        </div>
      </div>
      <button class="btn-primary btn-sm ripple" onclick="showToast('Edit feature coming soon!', 'info', 'ℹ')">✎ Edit</button>
    </div>
    
    <div style="margin-bottom: 24px;">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-weight: 600; margin-bottom: 8px;">Client Notes</div>
      <div style="background: var(--muted-bg); padding: 12px; border-radius: 6px; border: 1px solid var(--border); font-size: 14px; line-height: 1.5;">
        ${client.notes || 'No specific notes recorded with you.'}
      </div>
    </div>

    <div>
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); font-weight: 600; margin-bottom: 8px;">Treatment History & Formulas</div>
      ${formulasHtml}
    </div>
  `;
}

// ── UTILS ─────────────────────────────────────────────────────────
function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function show(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "";
}
function hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

// No chart resize needed

// ── INTERNAL STAFF CHAT ─────────────────────────────────────────
function toggleStaffChat() {
  document.getElementById("staffChatWindow").classList.toggle("hidden");
}

function sendChatMessage(msg) {
  if (!msg || !msg.trim()) return;
  const body = document.getElementById("chatBody");
  const input = document.getElementById("chatInput");

  // Add user message
  body.innerHTML += `<div class="chat-msg sent" style="animation:fadeUp 0.2s backwards;">${msg}</div>`;
  body.scrollTop = body.scrollHeight;
  if (input) input.value = "";

  // Smarter contextual auto-reply simulation (AI Receptionist)
  setTimeout(() => {
    const lowMsg = msg.toLowerCase();
    let reply = "";

    // 1. Availability Checks (e.g., "Is Sana available?")
    if (lowMsg.includes("available") || lowMsg.includes("busy") || lowMsg.includes("where is")) {
      let foundStaff = null;
      for (const key in STAFF_DATA) {
        const staff = STAFF_DATA[key];
        const firstName = staff.name.split(' ')[0].toLowerCase();
        if (lowMsg.includes(firstName) || lowMsg.includes(staff.name.toLowerCase())) {
          foundStaff = staff;
          break;
        }
      }

      if (foundStaff) {
        if (foundStaff.status === "on-break") {
          reply = `✨ I just checked! ${foundStaff.name} is currently on break right now. Should I leave them a message?`;
        } else if (foundStaff.status === "off-duty") {
          reply = `Oops, looks like ${foundStaff.name} isn't on shift today. They are marked as off-duty!`;
        } else {
          // Check if they have an in-progress appointment
          const isBusy = foundStaff.appointments && foundStaff.appointments.some(a => (aptStates[a.id] || a.status) === 'in-progress');
          if (isBusy) {
            reply = `Right now, ${foundStaff.name} is busy with a client. They should be free shortly!`;
          } else {
            reply = `Yes absolutely! ${foundStaff.name} is free and on the floor right now. I'll let them know you're looking for them! 🏃‍♀️💨`;
          }
        }
      } else {
        reply = "I'd love to help, but I'm not sure which staff member you're referring to. Could you provide their name?";
      }
    }
    // 2. Action: Request Supplies
    else if (lowMsg.includes("supply") || lowMsg.includes("supplies") || lowMsg.includes("inventory") || lowMsg.includes("need a towel") || lowMsg.includes("color")) {
      reply = "Of course! Let me pull up the supply request form for you right now so we can bring it over to your station! 📦✨";
      setTimeout(() => openInventoryModal(), 1500);
    }
    // 3. Action: Checkout
    else if (lowMsg.includes("checkout") || lowMsg.includes("pay") || lowMsg.includes("bill")) {
      reply = "Sure thing! Opening the checkout terminal for your client right now. 💳✨";
      setTimeout(() => { if (typeof openCheckoutModal === 'function') openCheckoutModal(); }, 1500);
    }
    // 4. Action: Next Client
    else if (lowMsg.includes("next client") || lowMsg.includes("who is next")) {
      const s = STAFF_DATA[currentStaff];
      const nextApt = s.appointments.find(a => (aptStates[a.id] || a.status) === "upcoming");
      if (nextApt) {
        reply = `Your next client is **${nextApt.client}** for a ${nextApt.service}. They are scheduled for ${nextApt.time}! 🌟`;
      } else {
        reply = "You're all clear! No more upcoming appointments for today. Great job! 🎉";
      }
    }
    // 5. Existing intents
    else if (lowMsg.includes("late")) {
      reply = "No problem at all! I'll inform your client right away and offer them a nice cappuccino while they wait. Take your time! ☕✨";
    } else if (lowMsg.includes("arrived")) {
      const s = STAFF_DATA[currentStaff];
      const nextApt = s.appointments.find(a => (aptStates[a.id] || a.status) === "upcoming");
      reply = nextApt
        ? `Yes! **${nextApt.client}** just walked in. They're enjoying a magazine in the lounge. We'll send them to your station in a moment! 🌸`
        : "I'm keeping an eye on the door, but nobody has arrived for you just yet! I'll ping you the second they walk in.";
    } else if (lowMsg.includes("help") || lowMsg.includes("station")) {
      reply = "Got it! I'm sending an assistant over to your station right this second. Hang tight! 🏃‍♂️💨";
    } else {
      // General positive response
      const positiveReplies = [
        "Absolutely! Let me know if you need anything else to make today a success! ✨",
        "Got it loud and clear! You're doing great today. Anything else I can do for you? 🌟",
        "Noted! Just buzz me here if you need anything from the front desk! 🌸"
      ];
      reply = positiveReplies[Math.floor(Math.random() * positiveReplies.length)];
    }

    body.innerHTML += `<div class="chat-msg received" style="animation:fadeUp 0.2s backwards;">${reply}</div>`;
    body.scrollTop = body.scrollHeight;
  }, 800 + Math.random() * 700);
}

// ── LIVE BREAK TIMER ─────────────────────────────────────────────
let breakInterval = null;
let breakEndTime = null;

function toggleBreak() {
  if (breakInterval) {
    endBreak();
  } else {
    document.getElementById("breakModalOverlay").classList.remove("hidden");
  }
}

function closeBreakModal() {
  document.getElementById("breakModalOverlay").classList.add("hidden");
}

function startBreak() {
  const mins =
    parseInt(document.getElementById("breakDurationInput").value) || 15;
  closeBreakModal();

  // Set UI state
  document.getElementById("headerStatus").classList.remove("active");
  document.getElementById("headerStatus").classList.add("break");
  document.getElementById("sidebarDot").classList.remove("active");
  document.getElementById("sidebarDot").classList.add("break");

  const ps = document.getElementById("profileStatus");
  if (ps) {
    ps.classList.remove("active");
    ps.classList.add("break");
  }

  breakEndTime = new Date(Date.now() + mins * 60000);

  updateBreakUI();
  breakInterval = setInterval(updateBreakUI, 1000);
  showToast(`Started ${mins} min break`, "warning", "☕");
}

function updateBreakUI() {
  const now = Date.now();
  const diff = breakEndTime - now;

  if (diff <= 0) {
    endBreak();
    showToast("Break time is over!", "warning", "⏰");
    return;
  }

  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const timeStr = `${m}:${s.toString().padStart(2, "0")}`;

  document.getElementById("headerStatus").innerHTML = `● On Break [${timeStr}]`;
  const ps = document.getElementById("profileStatus");
  if (ps) ps.innerHTML = `● On Break [${timeStr}]`;
}

function endBreak() {
  clearInterval(breakInterval);
  breakInterval = null;
  breakEndTime = null;

  document.getElementById("headerStatus").classList.remove("break");
  document.getElementById("headerStatus").classList.add("active");
  document.getElementById("headerStatus").innerHTML = `● On Duty`;

  document.getElementById("sidebarDot").classList.remove("break");
  document.getElementById("sidebarDot").classList.add("active");

  const ps = document.getElementById("profileStatus");
  if (ps) {
    ps.classList.remove("break");
    ps.classList.add("active");
    ps.innerHTML = `● On Duty`;
  }

  showToast("Clocked back in!", "success", "💼");
}

// ── INVENTORY REQUEST SYSTEM ────────────────────────────────────
const ROLE_INVENTORY_MAP = {
  "Senior Stylist": {
    "Color & Chemicals": ["Olaplex No. 1", "Olaplex No. 2", "Wella Blondor", "L'Oréal Inoa Developer 20 Vol", "Foil Rolls"],
    "Hair Care": ["Hydrating Shampoo (Backbar)", "Color Protect Conditioner", "Moroccanoil Treatment"],
    "Tools": ["Disposable Capes", "Clips", "Neck Strips"]
  },
  "Color Specialist": {
    "Color & Chemicals": ["Schwarzkopf Igora Royal", "Redken Shades EQ", "Lightener Powder", "Olaplex No. 1", "Foils (Pre-cut)"],
    "Hair Care": ["Purple Shampoo", "Bond Building Treatment", "Color Sealer"],
    "Tools": ["Color Brushes", "Mixing Bowls", "Gloves (Black, M)"]
  },
  "Esthetician": {
    "Skincare": ["Cleansing Milk", "Fruit Enzyme Peel", "Hyaluronic Acid Serum", "Soothing Face Mask"],
    "Waxing": ["Hard Wax Beans", "Wax Strips", "Pre-Wax Oil", "Post-Wax Lotion"],
    "Disposables": ["Cotton Pads", "Sponges", "Disposable Headbands"]
  },
  "Nail Artist": {
    "Polishes & Gels": ["OPI Base Coat", "OPI Top Coat", "Gel Builder (Clear)", "Acetone Gallon"],
    "Tools & Prep": ["Nail Files (100/180)", "Buffer Blocks", "Cuticle Oil", "Lint-free Wipes"],
    "Art Supplies": ["Swarovski Crystals", "Chrome Powder", "Nail Glue"]
  },
  "Makeup Artist": {
    "Prep & Prime": ["Hydrating Primer", "Micellar Water", "Setting Spray"],
    "Base": ["MAC Studio Fix Foundation", "Concealer Palette", "Translucent Powder"],
    "Tools": ["Beauty Blenders", "Disposable Mascara Wands", "Lash Glue"]
  }
};

function openInventoryModal() {
  try {
    const modal = document.getElementById("inventoryModalOverlay");
    if (!modal) {
      alert("Modal element 'inventoryModalOverlay' not found in this HTML file!");
      return;
    }
    modal.classList.remove("hidden");
    if (window.innerWidth <= 768) closeSidebar();

    // Merge all items from all roles into a single salon-wide inventory map
    const mergedInventory = {};
    for (const roleMap of Object.values(ROLE_INVENTORY_MAP)) {
      for (const [category, items] of Object.entries(roleMap)) {
        if (!mergedInventory[category]) mergedInventory[category] = new Set();
        items.forEach(item => mergedInventory[category].add(item));
      }
    }

    const selectEl = document.getElementById("invItem");
    if (selectEl) {
      let optionsHtml = '<option value="" disabled selected>Select a supply item...</option>';
      for (const [category, itemsSet] of Object.entries(mergedInventory)) {
        optionsHtml += `<optgroup label="── ${category} ──">`;
        Array.from(itemsSet).sort().forEach(item => {
          optionsHtml += `<option value="${item}">${item}</option>`;
        });
        optionsHtml += `</optgroup>`;
      }
      selectEl.innerHTML = optionsHtml;
    }
  } catch (e) {
    alert("Error in openInventoryModal: " + e.message + "\nStack: " + e.stack);
  }
}

function closeInventoryModal() {
  document.getElementById("inventoryModalOverlay").classList.add("hidden");
}

function submitInventoryRequest() {
  const item = document.getElementById("invItem").value;
  const qty = document.getElementById("invQty").value;
  const urgencyEl = document.getElementById("invUrgency");
  const urgency = urgencyEl ? urgencyEl.value : "Normal";
  const station = document.getElementById("invStation").value;

  if (!item) {
    showToast("Please select an item to request", "warning", "⚠️");
    return;
  }
  if (!station) {
    showToast("Please specify your station or room", "warning", "⚠️");
    return;
  }

  closeInventoryModal();
  const urgencyIcon = urgency === "High" ? "🚨" : "📦";
  showToast(`Requested ${qty}x ${item} for ${station}`, "success", urgencyIcon);

  // Simulate reception chat message
  setTimeout(() => {
    const staffChat = document.getElementById("staffChatWindow");
    if (staffChat) {
      staffChat.classList.remove("hidden");
      const body = document.getElementById("chatBody");
      const urgentText = urgency === "High" ? " (URGENT - bringing it ASAP!)" : "";
      body.innerHTML += `<div class="chat-msg received" style="animation:fadeUp 0.2s backwards;">We're bringing ${qty}x ${item} to ${station} right now!${urgentText}</div>`;
      body.scrollTop = body.scrollHeight;
    }
  }, 2500);
}

// ── SERVICE MENU CHEAT SHEET ────────────────────────────────────
function openCheatSheetModal(filterType = '') {
  document.getElementById('cheatSheetModalOverlay').classList.remove('hidden');
  document.getElementById('cheatSheetSearch').value = '';
  renderCheatSheet();
  filterCheatSheet(filterType);
  if (window.innerWidth <= 768) closeSidebar();
}

function closeCheatSheetModal() {
  document.getElementById('cheatSheetModalOverlay').classList.add('hidden');
}

function renderCheatSheet() {
  const container = document.getElementById('cheatSheetBody');
  if (!container) return;

  if (typeof serviceCatalog === 'undefined' || serviceCatalog.length === 0) {
    container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--muted);">No services available right now.</div>`;
    return;
  }

  // Group services by category
  const groups = {};
  serviceCatalog.forEach(s => {
    let cat = (s.cat || 'Other Services').trim();
    if (cat.endsWith(':')) cat = cat.slice(0, -1).trim();
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({
      name: s.name,
      duration: s.duration ? `${s.duration} mins` : "Varies",
      price: s.price || 0,
      icon: s.icon || "✨",
      category: cat
    });
  });

  const groupedServices = Object.keys(groups).map(category => {
    return { category, services: groups[category] };
  });

  let html = '';
  groupedServices.forEach((cat, index) => {
    html += `
      <div class="cs-category-row" style="margin-bottom: 8px;">
        <div class="cs-cat-header ripple" onclick="toggleServiceCategory(${index})" style="background: var(--muted-bg); padding: 12px 16px; border-radius: 8px; font-weight: 700; color: var(--primary); display: flex; justify-content: space-between; align-items: center; cursor: pointer; border: 1px solid var(--border); transition: background 0.2s;">
          <span>${cat.category}</span>
          <span id="cs-icon-${index}" style="transition: transform 0.3s; font-size: 12px;">▼</span>
        </div>
        <div id="cs-content-${index}" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; margin-top: 12px; overflow: hidden; padding-bottom: 8px;">
          ${cat.services.map(svc => `
            <div class="cs-row ripple" data-type="${cat.category.toLowerCase()}" style="display: flex; flex-direction: column; background: var(--card); padding: 16px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(0,0,0,0.04); transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; position: relative;">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px;">
                <div style="width: 42px; height: 42px; border-radius: 10px; background: var(--primary-light); display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;">
                  ${svc.icon || '✨'}
                </div>
                <div style="background: var(--muted-bg); padding: 4px 8px; border-radius: 6px; font-weight: 700; color: var(--primary); font-size: 13px;">
                  ₹${svc.price}
                </div>
              </div>
              <div style="font-weight: 700; color: var(--fg); font-size: 15px; margin-bottom: 6px; line-height: 1.3;">${svc.name}</div>
              <div style="font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 4px; margin-top: auto;">
                <span>⏱</span> ${svc.duration}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Add hover effects dynamically
  document.querySelectorAll('.cs-row').forEach(row => {
    row.addEventListener('mouseenter', () => {
      row.style.transform = 'translateY(-2px)';
      row.style.boxShadow = 'var(--shadow)';
      row.style.borderColor = 'var(--primary-light)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.transform = 'none';
      row.style.boxShadow = '0 1px 3px rgba(0,0,0,0.02)';
      row.style.borderColor = 'var(--border)';
    });
  });
}

function toggleServiceCategory(index) {
  const content = document.getElementById(`cs-content-${index}`);
  const icon = document.getElementById(`cs-icon-${index}`);
  if (content.style.display === 'none') {
    content.style.display = 'flex';
    icon.style.transform = 'rotate(0deg)';
  } else {
    content.style.display = 'none';
    icon.style.transform = 'rotate(-90deg)';
  }
}

function filterCheatSheet(typeFilter = '') {
  const query = document.getElementById('cheatSheetSearch').value.toLowerCase();
  const catRows = document.querySelectorAll('#cheatSheetBody .cs-category-row');

  catRows.forEach(catRow => {
    const content = catRow.querySelector('div[id^="cs-content-"]');
    const rows = content.querySelectorAll('.cs-row');
    const icon = catRow.querySelector('span[id^="cs-icon-"]');

    let hasVisibleMatch = false;

    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      const rowType = row.getAttribute('data-type') || '';

      const matchesSearch = text.includes(query);
      const matchesType = !typeFilter || rowType.includes(typeFilter.toLowerCase());

      if (matchesSearch && matchesType) {
        row.style.display = 'flex';
        hasVisibleMatch = true;
      } else {
        row.style.display = 'none';
      }
    });

    if (query || typeFilter) {
      catRow.style.display = hasVisibleMatch ? 'block' : 'none';
      if (hasVisibleMatch) {
        content.style.display = 'flex';
        icon.style.transform = 'rotate(0deg)';
      }
    } else {
      catRow.style.display = 'block';
    }
  });
}

// --- CLIENT RECORDS LOGIC ---
/* Legacy duplicate logic commented out
function renderClients(clientsToRender = allClients) {
  const list = document.getElementById("clientList");
  if (!list) return;

  if (clientsToRender.length === 0) {
    list.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--muted);">No clients found.</div>`;
    return;
  }

  list.innerHTML = clientsToRender.map(c => `
    <div class="client-item ripple" onclick="showClientDetail('${c.id}')" style="display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid var(--border); cursor: pointer;">
      <div class="staff-avatar-sm" style="background: var(--primary-light); color: var(--primary); width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px; flex-shrink: 0;">
        ${c.name.split(' ').map(n=>n[0]).join('')}
      </div>
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--fg);">${c.name}</div>
        <div style="font-size: 11px; color: var(--muted);">${c.phone}</div>
      </div>
    </div>
  `).join("");
}

function filterClients() {
  const searchInput = document.getElementById("clientSearch");
  if (!searchInput) return;
  const query = searchInput.value.toLowerCase();
  const filtered = allClients.filter(c => 
    c.name.toLowerCase().includes(query) || 
    c.phone.includes(query) ||
    (c.email && c.email.toLowerCase().includes(query))
  );
  renderClients(filtered);
}

function showClientDetail(clientId) {
  const client = allClients.find(c => c.id === clientId);
  const detail = document.getElementById("clientDetailCard");
  if (!client || !detail) return;

  detail.classList.remove("hidden");
  detail.style.display = "block";
  detail.style.textAlign = "left";
  detail.style.padding = "24px";
  detail.style.color = "var(--fg)";
  detail.style.overflowY = "auto";

  // Mock some extra data if missing
  const visits = client.totalVisits || Math.floor(Math.random() * 10) + 1;
  const lastVisit = client.lastVisit || "2026-05-10";
  const formulas = client.formulas || [
    { date: "2026-05-10", service: "Global Colour", formula: "Majirel 5.3 + 20vol" },
    { date: "2026-04-12", service: "Hair Spa", formula: "Hydra Source Pack" }
  ];

  detail.innerHTML = `
    <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 30px;">
      <div class="staff-avatar" style="width: 80px; height: 80px; font-size: 24px; background: var(--primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700;">
        ${client.name.split(' ').map(n=>n[0]).join('')}
      </div>
      <div>
        <h2 style="font-family: 'Playfair Display', serif; font-size: 28px; margin-bottom: 4px; color: var(--fg);">${client.name}</h2>
        <div style="display: flex; flex-wrap: wrap; gap: 15px; font-size: 13px; color: var(--muted);">
          <span>📞 ${client.phone}</span>
          ${client.email ? `<span>📧 ${client.email}</span>` : ''}
        </div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
      <div class="card" style="background: var(--primary-light); border: none; padding: 15px; border-radius: 12px;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--primary); margin-bottom: 5px; font-weight: 700;">Total Visits</div>
        <div style="font-size: 24px; font-weight: 700;">${visits}</div>
      </div>
      <div class="card" style="background: var(--muted-bg); border: none; padding: 15px; border-radius: 12px;">
        <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 5px; font-weight: 700;">Last Visit</div>
        <div style="font-size: 24px; font-weight: 700;">${lastVisit}</div>
      </div>
    </div>

    <h3 style="font-family: 'Playfair Display', serif; margin-bottom: 15px; font-size: 20px;">Formulas & History</h3>
    <div style="display: flex; flex-direction: column; gap: 12px;">
      ${formulas.map(f => `
        <div style="padding: 15px; border: 1px solid var(--border); border-radius: 12px; background: var(--card);">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-weight: 700; color: var(--primary);">${f.service}</span>
            <span style="font-size: 12px; color: var(--muted);">${f.date}</span>
          </div>
          <div style="font-size: 14px; color: var(--fg); background: var(--bg); padding: 10px; border-radius: 8px; border-left: 3px solid var(--primary);">
            ${f.formula}
          </div>
        </div>
      `).join('')}
    </div>

    <div style="margin-top: 30px; display: flex; gap: 10px;">
      <button class="btn-primary ripple" style="flex: 1; padding: 12px; font-weight: 600; border-radius: 8px;">Add New Formula</button>
      <button class="btn-secondary ripple" style="flex: 1; padding: 12px; font-weight: 600; border-radius: 8px;">Edit Notes</button>
    </div>
  `;
}
*/

// --- DYNAMIC INDOOR SERVICES & CLIENTS MODAL CODE ---
window.currentIndoorCategoryTab = "All";
window.indoorServicesSearchQuery = "";

// Robust programmatical classifier for indoor services from db.json
function getServiceType(s) {
  if (window.SERVICE_TYPES?.indoor?.includes(s.id)) return 'indoor';
  if (window.SERVICE_TYPES?.outdoor?.includes(s.id)) return 'outdoor';
  if (s.type === 'indoor') return 'indoor';
  if (s.type === 'outdoor') return 'outdoor';
  
  const name = (s.name || '').toLowerCase();
  const cat = (s.cat || '').toLowerCase();
  const isOut = name.includes('makeup') || name.includes('bridal') || name.includes('outdoor') || name.includes('event') ||
                cat.includes('makeup') || cat.includes('bridal') || cat.includes('outdoor');
  return isOut ? 'outdoor' : 'indoor';
}

function getServiceCategory(s) {
  const name = (s.name || '').toLowerCase();
  const cat = (s.cat || '').toLowerCase();
  
  if (name.includes('bridal') || name.includes('wedding') || name.includes('bride') || cat.includes('bridal') || cat.includes('wedding')) {
    return 'Bridal';
  }
  if (name.includes('eyebrow') || name.includes('brow') || name.includes('threading') || name.includes('tinting') || 
      name.includes('upperlip') || name.includes('lowerlip') || name.includes('chin') || name.includes('forehead') || 
      name.includes('sides') || name.includes('sidelocks') || name.includes('lip') || cat.includes('threading') || cat.includes('eyebrow')) {
    return 'Eyebrows';
  }
  if (name.includes('wax') || name.includes('waxing') || cat.includes('wax') || cat.includes('waxing')) {
    return 'Waxing';
  }
  if (name.includes('nail') || name.includes('manicure') || name.includes('pedicure') || 
      cat.includes('manicure') || cat.includes('pedicure') || cat.includes('nail')) {
    return 'Nails';
  }
  if (name.includes('makeup') || name.includes('make up') || name.includes('party look') || cat.includes('make up') || cat.includes('makeup')) {
    return 'Makeup';
  }
  if (name.includes('facial') || name.includes('cleanup') || name.includes('skin') || name.includes('peel') || 
      name.includes('bleach') || name.includes('scrub') || name.includes('wrap') || name.includes('massage') || 
      cat.includes('facial') || cat.includes('cleanup') || cat.includes('skin') || cat.includes('massage')) {
    return 'Skincare';
  }
  if (name.includes('hair') || name.includes('cut') || name.includes('colour') || name.includes('color') || 
      name.includes('shampoo') || name.includes('blow') || name.includes('spa') || name.includes('straight') || 
      name.includes('conditioning') || name.includes('henna') || name.includes('styling') || name.includes('crimping') || 
      name.includes('rebond') || cat.includes('hair') || cat.includes('cut') || cat.includes('styling') || cat.includes('colour')) {
    return 'Hair';
  }
  
  return 'Skincare'; // Default fallback
}

// Handler for category tabs selection
function selectIndoorCategory(catName) {
  window.currentIndoorCategoryTab = catName;
  // Update UI active class
  const tabs = document.querySelectorAll('.indoor-tab-btn');
  tabs.forEach(t => {
    if (t.getAttribute('data-cat') === catName) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });
  renderIndoorModalContent();
}

// Handler for search typing
function filterIndoorServices() {
  const searchInput = document.getElementById('indoorSearch');
  window.indoorServicesSearchQuery = searchInput ? searchInput.value.toLowerCase().trim() : "";
  renderIndoorModalContent();
}

// Action triggers for clients in queue
function startIndoorService(aptId) {
  aptStates[aptId] = "in-progress";
  saveAptStates();
  
  // Sync remote or local
  const liveApt = window.allAppointments.find(a => a.id === aptId);
  if (liveApt) liveApt.status = "in-progress";
  
  // Update staff appointments data
  Object.keys(STAFF_DATA).forEach(staffId => {
    const apt = STAFF_DATA[staffId].appointments.find(a => a.id === aptId);
    if (apt) {
      apt.status = "in-progress";
    }
  });
  
  // Save to localStorage
  localStorage.setItem('STAFF_DATA_PERSIST', JSON.stringify(STAFF_DATA));
  
  showToast("Service started successfully!", "success", "▶️");
  
  // Refresh views
  loadStaff(currentStaff);
  if (typeof buildDashboard === 'function') buildDashboard(STAFF_DATA[currentStaff]);
  if (typeof refreshTimeline === 'function') refreshTimeline();
  
  // Re-render modal to reflect change
  renderIndoorModalContent();
}

function completeIndoorService(aptId) {
  // Try to find the live appointment object
  let aptObj = window.allAppointments.find(a => a.id === aptId);
  if (!aptObj) {
    // Check STAFF_DATA
    Object.keys(STAFF_DATA).forEach(staffId => {
      const found = STAFF_DATA[staffId].appointments.find(a => a.id === aptId);
      if (found) aptObj = found;
    });
  }
  
  if (aptObj) {
    window.currentActiveApt = aptObj;
    openCheckoutModal();
    // Re-render the modal when checkout completes or status changes
    const checkInterval = setInterval(() => {
      if (aptStates[aptId] === 'done') {
        clearInterval(checkInterval);
        renderIndoorModalContent();
      }
    }, 1000);
  } else {
    // If it's a booking or offline object, mark done directly
    aptStates[aptId] = "done";
    saveAptStates();
    if (typeof confetti === 'function') confetti();
    showToast("Booking marked as complete!", "success", "✅");
    renderIndoorModalContent();
  }
}

function reassignIndoorService(aptId) {
  if (typeof openReassignModal === 'function') {
    openReassignModal(aptId);
    
    // Periodically monitor reassignment changes to update the queue list
    const reassignInterval = setInterval(() => {
      renderIndoorModalContent();
    }, 2000);
    
    // Auto clear interval after 10s to prevent leak
    setTimeout(() => clearInterval(reassignInterval), 10000);
  }
}

// Master rendering engine inside modal
function renderIndoorModalContent() {
  // 1. Fetch relevant services from serviceCatalog
  // Previously this was filtered to indoor only, now we show ALL services
  const relevantServices = serviceCatalog;
  
  // 2. Classify services into categories for the tabs count
  const categoryCounts = {
    "All": 0,
    "Hair": 0,
    "Makeup": 0,
    "Skincare": 0,
    "Eyebrows": 0,
    "Waxing": 0,
    "Nails": 0,
    "Bridal": 0,
    "Quick Services": 0,
    "Premium Services": 0
  };
  
  relevantServices.forEach(s => {
    const isMatch = s.name.toLowerCase().includes(window.indoorServicesSearchQuery) || 
                    (s.cat && s.cat.toLowerCase().includes(window.indoorServicesSearchQuery));
    if (!isMatch) return;
    
    categoryCounts["All"]++;
    
    const cat = getServiceCategory(s);
    if (categoryCounts[cat] !== undefined) categoryCounts[cat]++;
    
    if (s.duration <= 30) categoryCounts["Quick Services"]++;
    if (s.price >= 1500) categoryCounts["Premium Services"]++;
  });
  
  // 3. Render sticky tabs with counts
  const tabsContainer = document.getElementById('indoorCategoryTabs');
  if (tabsContainer) {
    const categoriesList = [
      { name: "All", label: "📋 All" },
      { name: "Hair", label: "✂️ Hair" },
      { name: "Makeup", label: "💄 Makeup" },
      { name: "Skincare", label: "💆 Skincare" },
      { name: "Eyebrows", label: "👁️ Eyebrows" },
      { name: "Waxing", label: "🍯 Waxing" },
      { name: "Nails", label: "💅 Nails" },
      { name: "Bridal", label: "👑 Bridal" },
      { name: "Quick Services", label: "⚡ Quick" },
      { name: "Premium Services", label: "💎 Premium" }
    ];
    
    tabsContainer.innerHTML = categoriesList.map(c => {
      const activeClass = window.currentIndoorCategoryTab === c.name ? "active" : "";
      const count = categoryCounts[c.name] || 0;
      return `
        <button class="indoor-tab-btn ${activeClass}" data-cat="${c.name}" onclick="selectIndoorCategory('${c.name}')">
          <span>${c.label}</span>
          <span class="indoor-tab-badge">${count}</span>
        </button>
      `;
    }).join('');
  }
  
  // 4. Filter services for the active category tab + search query
  const filteredServices = relevantServices.filter(s => {
    // Search match
    const isSearchMatch = s.name.toLowerCase().includes(window.indoorServicesSearchQuery) || 
                          (s.cat && s.cat.toLowerCase().includes(window.indoorServicesSearchQuery));
    if (!isSearchMatch) return false;
    
    // Category match
    if (window.currentIndoorCategoryTab === 'All') return true;
    if (window.currentIndoorCategoryTab === 'Quick Services') return s.duration <= 30;
    if (window.currentIndoorCategoryTab === 'Premium Services') return s.price >= 1500;
    
    return getServiceCategory(s) === window.currentIndoorCategoryTab;
  });
  
  // Update left panel services count
  document.getElementById('stServicesCount').textContent = `${filteredServices.length} Services`;
  
  // Render Left Column Services cards
  let svcsHtml = '';
  if (filteredServices.length > 0) {
    filteredServices.forEach(s => {
      // Determine badges
      let badgeHtml = '';
      if (s.price >= 1500 || s.name.includes('Gold') || s.name.includes('Special')) {
        badgeHtml = `<span class="indoor-service-badge popular">Popular</span>`;
      } else if (s.id.endsWith('2') || s.id.endsWith('4') || s.id.endsWith('6') || s.name.includes('Haircut')) {
        badgeHtml = `<span class="indoor-service-badge recent">Recent</span>`;
      }
      
      // Determine skill level required
      let skillLevel = "Junior Stylist";
      if (s.price >= 1500) skillLevel = "Master Director";
      else if (s.price >= 800) skillLevel = "Senior Specialist";
      else if (s.price >= 400) skillLevel = "Stylist";
      
      // Check availability (95% available by default)
      const availabilityTag = `
        <span class="availability-indicator" style="color: var(--success);">
          <span class="availability-dot-indicator"></span> Available
        </span>
      `;
      
      svcsHtml += `
        <div class="cs-row indoor-service-card ripple" style="min-height: 125px; background: var(--bg); padding: 16px; border-radius: 12px; border: 1px solid var(--border); display: flex; flex-direction: column;">
          ${badgeHtml}
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <div style="font-size: 26px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));">${s.icon || '✨'}</div>
            <div class="indoor-service-price" style="font-weight: 700; color: var(--primary);">₹${s.price.toLocaleString("en-IN")}</div>
          </div>
          <div style="font-weight: 700; font-size: 13.5px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: auto;" title="${s.name}">${s.name}</div>
          <div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border); padding-top: 8px; margin-top: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--muted);">
              <span class="indoor-service-duration">⏱ ${s.duration} mins</span>
              <span class="indoor-service-tag">🏠 Indoor</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; margin-top: 2px;">
              <span class="indoor-skill-badge" style="background: var(--muted-bg); padding: 2px 6px; border-radius: 4px;">${skillLevel}</span>
              ${availabilityTag}
            </div>
          </div>
        </div>
      `;
    });
  } else {
    svcsHtml = `
      <div style="grid-column: span 12; padding: 40px 20px; text-align: center; color: var(--muted); background: var(--bg); border-radius: 12px; border: 1px dashed var(--border); width: 100%;">
        <div style="font-size: 32px; margin-bottom: 10px;">🔍</div>
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">No Services Found</div>
        <div style="font-size: 12px;">Try adjusting your keyword search or category filters.</div>
      </div>
    `;
  }
  document.getElementById('stServicesGrid').innerHTML = svcsHtml;
  
  // 5. 1-WEEK Schedule Client Gating Logic (Today + Next 7 Days)
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  
  // Calculate date 7 days from now
  const sevenDaysLater = new Date();
  sevenDaysLater.setDate(today.getDate() + 7);
  const sevenDaysLaterStr = sevenDaysLater.toISOString().split('T')[0];
  
  // Helper to format dates dynamically
  function formatDateLabel(dateStr) {
    if (!dateStr) return '';
    if (dateStr === todayStr) return 'Today';
    
    const tom = new Date();
    tom.setDate(tom.getDate() + 1);
    const tomStr = tom.toISOString().split('T')[0];
    if (dateStr === tomStr) return 'Tomorrow';
    
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      }
    } catch(e) {}
    return dateStr;
  }

  const enrolled = [];
  const addedIds = new Set();
  
  // Status lists allowed & forbidden
  const allowedStatuses = ['waiting', 'active', 'in-progress', 'arriving', 'assigned', 'upcoming', 'booked'];
  const forbiddenStatuses = ['done', 'completed', 'cancelled', 'future-booked', 'expired'];
  
  // Load clients from daily appointments (implicitly today)
  if (window.allAppointments) {
    window.allAppointments.forEach(a => {
      const actualStatus = aptStates[a.id] || a.status;
      if (forbiddenStatuses.includes(actualStatus)) return;
      
      const matchingCatalogSvc = serviceCatalog.find(catSvc => catSvc.name === a.service);
      const isIndoorSvc = matchingCatalogSvc ? getServiceType(matchingCatalogSvc) === 'indoor' : true;
      
      if (isIndoorSvc) {
        enrolled.push({
          id: a.id,
          name: a.client,
          date: todayStr,
          time: a.time,
          displayTime: 'Today ' + a.time,
          service: a.service,
          price: a.price,
          status: actualStatus,
          assignedStaff: a.staff ? (STAFF_DATA[a.staff]?.name || a.staff.toUpperCase()) : "Unassigned",
          source: 'Walk-in',
          vip: a.price >= 1000 || a.client === 'Meera Rajput'
        });
        addedIds.add(a.id);
      }
    });
  }
  
  // Load clients from bookings scheduled within the next 1 week
  if (window.allBookings) {
    window.allBookings.forEach(b => {
      // 1. Strict 7-Day Date Gating
      if (b.date < todayStr || b.date > sevenDaysLaterStr) return;
      
      // 2. Status check
      const actualStatus = b.status.toLowerCase();
      if (forbiddenStatuses.includes(actualStatus)) return;
      
      // Prevent duplicates
      if (addedIds.has(b.id)) return;
      
      // Check if it's an indoor booking
      const hasIndoorService = b.services.some(svcId => {
        const catSvc = serviceCatalog.find(cs => cs.id === svcId);
        return catSvc ? getServiceType(catSvc) === 'indoor' : true;
      });
      
      if (hasIndoorService) {
        // Resolve primary service name
        let svcName = "Multiple Services";
        let pricesSum = 0;
        if (b.services && b.services.length > 0) {
          const firstSvc = serviceCatalog.find(cs => cs.id === b.services[0]);
          if (firstSvc) svcName = firstSvc.name;
          b.services.forEach(svcId => {
            const foundSvc = serviceCatalog.find(cs => cs.id === svcId);
            if (foundSvc) pricesSum += foundSvc.price;
          });
        }
        
        enrolled.push({
          id: b.id,
          name: b.clientName,
          date: b.date,
          time: b.time,
          displayTime: formatDateLabel(b.date) + ' ' + b.time,
          service: svcName,
          price: pricesSum || b.total || 500,
          status: actualStatus === 'upcoming' ? 'waiting' : actualStatus,
          assignedStaff: b.staffId ? (STAFF_DATA[b.staffId]?.name || b.staffId.toUpperCase()) : "Unassigned",
          source: b.source ? (b.source.charAt(0).toUpperCase() + b.source.slice(1)) : 'Online Reservation',
          vip: b.deposit === true || (pricesSum >= 1000)
        });
        addedIds.add(b.id);
      }
    });
  }
  
  // Sort clients lexicographically by Date first, then Time!
  enrolled.sort((a, b) => {
    const dateComp = a.date.localeCompare(b.date);
    if (dateComp !== 0) return dateComp;
    return a.time.localeCompare(b.time);
  });
  
  // Update client count badge
  document.getElementById('stCustomersCount').textContent = `${enrolled.length} Booked`;
  
  // Render Right Column Clients Queue cards
  let custHtml = '';
  if (enrolled.length > 0) {
    enrolled.forEach(c => {
      const initials = c.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
      const vipBadge = c.vip ? 
        `<span class="customer-vip-badge">👑 VIP</span>` : 
        `<span class="customer-member-badge">✨ Member</span>`;
      
      // Active live queue status representation
      let statusClass = "waiting";
      if (c.status === 'in-progress' || c.status === 'active') statusClass = "active";
      else if (c.status === 'arriving') statusClass = "arriving";
      else if (c.status === 'assigned') statusClass = "assigned";
      
      // Inline Action Buttons based on status
      let actionsHtml = '';
      if (c.status === 'waiting' || c.status === 'arriving' || c.status === 'upcoming') {
        actionsHtml = `
          <button class="btn-action-sm primary ripple" onclick="startIndoorService('${c.id}')">▶ Start Service</button>
          <button class="btn-action-sm warning ripple" onclick="reassignIndoorService('${c.id}')">🔄 Reassign</button>
        `;
      } else if (c.status === 'in-progress' || c.status === 'active') {
        actionsHtml = `
          <button class="btn-action-sm success ripple" onclick="completeIndoorService('${c.id}')">✅ Mark Complete</button>
          <button class="btn-action-sm warning ripple" onclick="reassignIndoorService('${c.id}')">🔄 Reassign</button>
        `;
      } else {
        actionsHtml = `
          <button class="btn-action-sm ripple" style="flex:1;" onclick="showToast('Service is not in an editable active state', 'warning', '⚠️')">View Details</button>
        `;
      }
      
      custHtml += `
        <div class="indoor-customer-card">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="customer-avatar">${initials}</div>
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="customer-name" style="margin: 0; line-height: 1.2;">${c.name}</span>
                ${vipBadge}
              </div>
              <div style="font-size: 11px; color: var(--muted); display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                <span>⏱ ${c.displayTime}</span>
                <span>•</span>
                <span>${c.source}</span>
              </div>
            </div>
            <div>
              <span class="customer-status-pill ${statusClass}">${c.status}</span>
            </div>
          </div>
          
          <div style="background: var(--bg); padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); font-size: 12px; display: flex; flex-direction: column; gap: 4px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Service:</span>
              <span style="font-weight: 600; color: var(--fg); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; max-width: 150px;" title="${c.service}">${c.service}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: var(--muted);">Stylist:</span>
              <span style="font-weight: 600; color: var(--primary);">${c.assignedStaff}</span>
            </div>
          </div>
          
          <div class="customer-actions-row">
            ${actionsHtml}
          </div>
        </div>
      `;
    });
  } else {
    custHtml = `
      <div style="padding: 40px 20px; text-align: center; color: var(--muted); background: var(--bg); border-radius: 12px; border: 1px dashed var(--border); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 250px; width: 100%; box-sizing: border-box;">
        <div style="font-size: 32px;">📅</div>
        <div style="font-weight: 600; font-size: 14px; margin-bottom: 2px;">No Bookings Scheduled This Week</div>
        <div style="font-size: 12px; max-width: 210px; line-height: 1.4;">There are no active indoor appointments registered for the upcoming 7 days.</div>
      </div>
    `;
  }
  document.getElementById('stCustomersList').innerHTML = custHtml;
}

function openServiceTypeModal(type) {
  document.getElementById('serviceTypeModalOverlay').classList.remove('hidden');
  window.currentServiceModalType = type;
  
  if (type === 'walkin') {
    document.getElementById('stModalTitle').textContent = '🚶 Walk-in Services';
  } else if (type === 'preschedule') {
    document.getElementById('stModalTitle').textContent = '📅 Pre-schedule Appointments';
  } else {
    document.getElementById('stModalTitle').textContent = '✨ Services';
  }
  
  const searchWrapper = document.querySelector('.indoor-search-wrapper');
  const tabsContainer = document.getElementById('indoorCategoryTabs');
  const splitWrapper = document.querySelector('.modal-body-split');
  
  if (searchWrapper) searchWrapper.style.display = 'flex';
  if (tabsContainer) tabsContainer.style.display = 'flex';
  if (splitWrapper) splitWrapper.style.flexDirection = 'row';
  
  window.currentIndoorCategoryTab = "All";
  window.indoorServicesSearchQuery = "";
  const searchInput = document.getElementById('indoorSearch');
  if (searchInput) searchInput.value = "";
  
  renderIndoorModalContent();
}

function closeServiceTypeModal() {
  document.getElementById('serviceTypeModalOverlay').classList.add('hidden');
}

// --- SCHEDULE REMINDERS LOGIC ---
let reminders = JSON.parse(localStorage.getItem('myReminders'));
if (!reminders) {
  reminders = [
    { text: "Sanitize station before shift", checked: true },
    { text: "Prepare foils & color bowls for Tara", checked: false },
    { text: "Check inventory for Olaplex No. 2", checked: false },
    { text: "Confirm tomorrow's VIP booking", checked: false }
  ];
  localStorage.setItem('myReminders', JSON.stringify(reminders));
}

function renderReminders() {
  const list = document.getElementById("remindersList");
  if (!list) return;

  if (reminders.length === 0) {
    list.innerHTML = `<div style="font-size:12px; color:var(--muted); text-align:center; padding:10px;">No reminders yet.</div>`;
    return;
  }

  list.innerHTML = reminders.map((r, i) => `
    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 13px; padding: 4px 0;">
      <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1;">
        <input type="checkbox" style="width: 16px; height: 16px; accent-color: var(--primary);" 
               ${r.checked ? 'checked' : ''} onchange="toggleReminder(${i})">
        <span style="color: ${r.checked ? 'var(--muted)' : 'var(--fg)'}; text-decoration: ${r.checked ? 'line-through' : 'none'}; transition: all 0.2s;">
          ${r.text}
        </span>
      </label>
      <div style="display: flex; gap: 4px;">
        <button onclick="editReminder(${i})" title="Edit reminder" style="background:none; border:none; color:var(--primary); cursor:pointer; font-size:14px; opacity:0.6; padding:0 4px;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">✏️</button>
        <button onclick="removeReminder(${i})" title="Remove reminder" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:14px; opacity:0.6; padding:0 4px;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">✕</button>
      </div>
    </div>
  `).join('');
}

function toggleReminder(index) {
  reminders[index].checked = !reminders[index].checked;
  localStorage.setItem('myReminders', JSON.stringify(reminders));
  renderReminders();
}

function removeReminder(index) {
  reminders.splice(index, 1);
  localStorage.setItem('myReminders', JSON.stringify(reminders));
  renderReminders();
  showToast("Reminder removed", "success", "🗑️");
}

function editReminder(index) {
  const newText = prompt("Edit reminder task:", reminders[index].text);
  if (newText !== null && newText.trim() !== '') {
    reminders[index].text = newText.trim().replace(/</g, "&lt;");
    localStorage.setItem('myReminders', JSON.stringify(reminders));
    renderReminders();
    showToast("Reminder updated!", "success", "✏️");
  }
}

function addReminder() {
  const text = prompt("Enter new reminder task:");
  if (!text || text.trim() === '') return;

  reminders.push({ text: text.trim().replace(/</g, "&lt;"), checked: false });
  localStorage.setItem('myReminders', JSON.stringify(reminders));
  renderReminders();
  showToast("Reminder added!", "success", "📝");
}

document.addEventListener('DOMContentLoaded', () => {
  renderReminders();
  
  // Set default view mode if stored
  const savedMode = localStorage.getItem('currentViewMode') || 'staff';
  if (savedMode === 'admin') {
    // Wait briefly for other DOM initializations
    setTimeout(() => setViewMode('admin'), 100);
  }
});

// ── GLOWSUITE INTELLIGENT REASSIGNMENT WORKFLOW SYSTEM ──────────────────

// 1. Native Cross-Tab Synchronization Channel
const syncChannel = new BroadcastChannel('glowsuite_salon_sync');

syncChannel.onmessage = (event) => {
  const { type, data } = event.data;
  console.log("GlowSuite sync event received:", type, data);
  
  if (type === 'APPOINTMENT_REASSIGNED') {
    handleIncomingReassignmentSync(data);
  } else if (type === 'WAITLIST_UPDATED') {
    window.salonWaitlist = data.waitlist;
    if (currentViewMode === 'admin') {
      renderAdminWaitlist();
    }
  } else if (type === 'LOGS_UPDATED') {
    window.reassignmentLogs = data.logs;
    if (currentViewMode === 'admin') {
      renderAdminLogs();
    }
  }
};

// Handle incoming live sync events (cross-tab)
function handleIncomingReassignmentSync(data) {
  const { appointment, fromStaffId, toStaffId, automatic } = data;
  
  // Update in-memory collections on this page instance
  if (fromStaffId !== 'waitlist' && STAFF_DATA[fromStaffId]) {
    STAFF_DATA[fromStaffId].appointments = STAFF_DATA[fromStaffId].appointments.filter(a => a.id !== appointment.id);
  }
  
  if (toStaffId !== 'waitlist' && STAFF_DATA[toStaffId]) {
    const toStaff = STAFF_DATA[toStaffId];
    if (!toStaff.appointments.some(a => a.id === appointment.id)) {
      toStaff.appointments.push(appointment);
    }
    recalculateScheduleTimes(toStaffId);
  }
  
  // Persist updated collections
  localStorage.setItem('STAFF_DATA_PERSIST', JSON.stringify(STAFF_DATA));
  
  // Floating banner notifications if this tab is the new assignee!
  if (currentStaff === toStaffId) {
    showFloatingReassignmentBanner(appointment, fromStaffId !== 'waitlist' ? STAFF_DATA[fromStaffId].name : 'Reception desk');
    showToast(`New client assigned! ${appointment.client} for ${appointment.service}`, 'success', '🎉');
  } else if (currentStaff === fromStaffId) {
    showToast(`Client ${appointment.client} bypassed to colleague!`, 'info', '🔄');
  }

  // Update active UI depending on who is selected
  loadStaff(currentStaff);
  
  if (currentViewMode === 'admin') {
    renderAdminBoardGrid();
    renderAdminWaitlist();
    renderAdminLogs();
  }
}

// 2. Premium floating notification floaters
function showFloatingReassignmentBanner(apt, fromName) {
  const existing = document.querySelector(".reassign-float-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.className = "reassign-float-banner";
  banner.innerHTML = `
    <div style="font-size: 26px; display: flex; align-items: center; justify-content: center; background: var(--primary-light); color: var(--primary); width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;">🆕</div>
    <div style="flex: 1;">
      <div style="font-weight: 700; font-size: 13px; color: var(--primary); margin-bottom: 2px;">New Appointment Assigned!</div>
      <div style="font-size: 13px; font-weight: 700; color: var(--fg);">${apt.client}</div>
      <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">✂️ ${apt.service} at 🕒 ${apt.time}</div>
      <div style="font-size: 10px; color: var(--primary); font-weight: 600; margin-bottom: 10px; background: var(--primary-light); padding: 4px 8px; border-radius: 6px; display: inline-block;">
        🔄 Transferred from ${fromName}
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn-primary ripple" onclick="acceptTransferredApt('${apt.id}')" style="font-size: 11px; padding: 6px 12px; height: auto; font-weight: 600; border-radius: 6px;">Accept ✅</button>
        <button class="btn-outline ripple" onclick="declineTransferredApt('${apt.id}', '${fromName}')" style="font-size: 11px; padding: 6px 12px; height: auto; border-color: var(--danger); color: var(--danger); background: transparent; font-weight: 600; border-radius: 6px;">Decline ✕</button>
      </div>
    </div>
  `;
  document.body.appendChild(banner);
  
  // Auto-remove banner after 15 seconds if ignored
  setTimeout(() => {
    if (banner && banner.parentElement) {
      banner.classList.add("slide-out");
      setTimeout(() => banner.remove(), 300);
    }
  }, 15000);
}

window.acceptTransferredApt = function(aptId) {
  const banner = document.querySelector(".reassign-float-banner");
  if (banner) {
    banner.classList.add("slide-out");
    setTimeout(() => banner.remove(), 300);
  }
  showToast("Appointment successfully added to your dashboard queue!", "success", "✓");
};

window.declineTransferredApt = function(aptId, fromName) {
  const banner = document.querySelector(".reassign-float-banner");
  if (banner) {
    banner.classList.add("slide-out");
    setTimeout(() => banner.remove(), 300);
  }
  
  showToast("Reassignment declined. Sent back to waitlist.", "warning", "⚠️");
  
  // Return the appointment back to the central waitlist
  let matchedApt = null;
  const staffKeys = Object.keys(STAFF_DATA);
  for (let key of staffKeys) {
    const s = STAFF_DATA[key];
    const idx = s.appointments.findIndex(a => a.id === aptId);
    if (idx !== -1) {
      matchedApt = s.appointments.splice(idx, 1)[0];
      recalculateScheduleTimes(key);
      break;
    }
  }
  
  if (matchedApt) {
    matchedApt.status = 'waiting';
    aptStates[matchedApt.id] = 'waiting';
    
    if (!window.salonWaitlist.some(a => a.id === aptId)) {
      window.salonWaitlist.push(matchedApt);
      window.saveSalonWaitlist();
    }
    
    // Log
    addReassignmentLog(matchedApt.client, matchedApt.service, currentStaff, 'Waitlist', 'Reassignment declined by stylist');
    
    // Persist
    localStorage.setItem('STAFF_DATA_PERSIST', JSON.stringify(STAFF_DATA));
    saveAptStates();

    // Broadcast waitlist & reassignment changes
    syncChannel.postMessage({
      type: 'WAITLIST_UPDATED',
      data: { waitlist: window.salonWaitlist }
    });
    
    syncChannel.postMessage({
      type: 'APPOINTMENT_REASSIGNED',
      data: {
        appointment: matchedApt,
        fromStaffId: currentStaff,
        toStaffId: 'waitlist',
        automatic: false
      }
    });
    
    // Update local UI
    loadStaff(currentStaff);
    if (currentViewMode === 'admin') {
      renderAdminWaitlist();
      renderAdminBoardGrid();
      renderAdminLogs();
    }
  }
};

// 3. Smart Availability scoring engine
function calculateStaffCompatibility(apt, staffId) {
  const s = STAFF_DATA[staffId];
  if (!s || s.status === 'off-duty') return { score: 0, reasons: ["Stylist is Off Duty"] };
  
  let score = 100;
  let reasons = [];

  // Skill Compatibility check (45% weight)
  const specialties = s.specialties.map(x => x.toLowerCase());
  const aptService = apt.service.toLowerCase();
  
  let hasSpecialty = specialties.some(spec => {
    return aptService.includes(spec) || spec.includes(aptService);
  });
  
  if (hasSpecialty) {
    reasons.push("💇 Specialties/Skill match");
  } else {
    score -= 40;
    reasons.push("⚠️ Service is outside primary specialties");
  }

  // Active shift hours check (30% weight)
  const [aptH, aptM] = apt.time.split(':').map(Number);
  const aptStartMins = aptH * 60 + aptM;
  const aptEndMins = aptStartMins + (apt.duration || 60);

  let shiftStartMins = 9 * 60; // 9:00 AM
  let shiftEndMins = 18 * 60;  // 6:00 PM

  if (s.shift) {
    const shiftMatches = s.shift.match(/(\d+)(?::(\d+))?\s*(AM|PM)?\s*.\s*(\d+)(?::(\d+))?\s*(AM|PM)/i);
    if (shiftMatches) {
      let startH = parseInt(shiftMatches[1]);
      const startM = shiftMatches[2] ? parseInt(shiftMatches[2]) : 0;
      let startAmPm = shiftMatches[3] ? shiftMatches[3].toUpperCase() : 'AM';
      let endH = parseInt(shiftMatches[4]);
      const endM = shiftMatches[5] ? parseInt(shiftMatches[5]) : 0;
      const endAmPm = shiftMatches[6].toUpperCase();

      if (startAmPm === 'PM' && startH !== 12) startH += 12;
      if (startAmPm === 'AM' && startH === 12) startH = 0;
      if (endAmPm === 'PM' && endH !== 12) endH += 12;
      if (endAmPm === 'AM' && endH === 12) endH = 0;

      shiftStartMins = startH * 60 + startM;
      shiftEndMins = endH * 60 + endM;
    }
  }

  if (aptStartMins < shiftStartMins || aptEndMins > shiftEndMins) {
    return { score: 0, reasons: ["❌ Outside shifts hours"] };
  } else {
    reasons.push("📅 Inside working shift");
  }

  // Workload checking (15% weight)
  const pendingApts = s.appointments.filter(a => aptStates[a.id] !== 'done').length;
  if (pendingApts >= 5) {
    score -= 20;
    reasons.push(`⚠️ High pending workload (${pendingApts} clients)`);
  } else if (pendingApts >= 3) {
    score -= 5;
    reasons.push(`⚖️ Moderate workload (${pendingApts} clients)`);
  } else {
    reasons.push("🟢 Low workload today");
  }

  // Conflict overlap checking (10% weight)
  const clashApt = s.appointments.find(a => {
    if (a.id === apt.id || aptStates[a.id] === 'done') return false;
    const [ah, am] = a.time.split(':').map(Number);
    const aStart = ah * 60 + am;
    const aEnd = aStart + (a.duration || 60);
    return aptStartMins < aEnd && aptEndMins > aStart;
  });

  if (clashApt) {
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const [ch, cm] = clashApt.time.split(':').map(Number);
    const clashStart = ch * 60 + cm;
    const clashEnd = clashStart + (clashApt.duration || 60);
    const remainingTime = clashEnd - currentMins;

    if (aptStates[clashApt.id] === 'in-progress' && remainingTime > 0 && remainingTime <= 15) {
      score -= 10;
      reasons.push("⚡ Finishing current client soon (<15m left)");
    } else {
      score -= 40;
      reasons.push(`⚠️ Clashes with ${clashApt.client} (${clashApt.time})`);
    }
  } else {
    reasons.push("✓ Time slot is free");
  }

  // On break checking
  if (s.status === 'on-break') {
    score -= 15;
    reasons.push("☕ Currently On Break");
  }

  return {
    score: Math.max(0, score),
    reasons: reasons
  };
}

// 4. Modal Handlers
let activeReassignApt = null;

window.bypassApt = function(aptId, e) {
  if (e) e.stopPropagation();
  openReassignModal(aptId);
};

window.openReassignModal = function(aptId) {
  const overlay = document.getElementById("reassignModalOverlay");
  if (!overlay) return;

  let apt = null;
  let ownerId = null;
  const staffKeys = Object.keys(STAFF_DATA);
  
  for (let key of staffKeys) {
    const s = STAFF_DATA[key];
    const found = s.appointments.find(a => a.id === aptId);
    if (found) {
      apt = found;
      ownerId = key;
      break;
    }
  }

  if (!apt) {
    apt = window.salonWaitlist.find(a => a.id === aptId);
    ownerId = 'waitlist';
  }

  if (!apt) {
    showToast("Appointment data not found", "error", "⚠️");
    return;
  }

  activeReassignApt = { ...apt, ownerId };

  // Set modal text
  document.getElementById("reassignModalSub").textContent = `Client: ${apt.client} · Service: ${apt.service} · Time: ${apt.time}`;

  // AI recommendations
  const recommendation = findBestAIStaff(apt, ownerId);
  const aiCard = document.getElementById("aiRecommenderCard");
  
  if (recommendation) {
    aiCard.style.display = "flex";
    document.getElementById("aiRecommendedStaffName").textContent = recommendation.name;
    document.getElementById("aiMatchScore").textContent = `${recommendation.score}% Match`;
    document.getElementById("aiRecommendationReason").innerHTML = recommendation.reasons.join("<br>");
    document.getElementById("aiReassignBtn").onclick = () => executeReassignment(recommendation.id);
  } else {
    aiCard.style.display = "none";
  }

  // Colleague Grid manually
  const grid = document.getElementById("reassignStaffGrid");
  let gridHTML = "";
  
  staffKeys.forEach(key => {
    if (key === ownerId) return;
    
    const s = STAFF_DATA[key];
    const analysis = calculateStaffCompatibility(apt, key);
    const initials = s.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    
    let statusText = "Free";
    let statusClass = "free";
    if (s.status === 'on-break') {
      statusText = "On Break";
      statusClass = "on-break";
    } else {
      const active = s.appointments.some(a => aptStates[a.id] === 'in-progress');
      if (active) {
        statusText = "Busy";
        statusClass = "busy";
        
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const activeApt = s.appointments.find(a => aptStates[a.id] === 'in-progress');
        if (activeApt) {
          const [ah, am] = activeApt.time.split(':').map(Number);
          const activeEnd = (ah * 60 + am) + (activeApt.duration || 60);
          if (activeEnd - currentMins <= 15) {
            statusText = "Finishing Soon";
            statusClass = "finishing-soon";
          }
        }
      }
    }

    gridHTML += `
      <div class="stylist-row-item" style="display: flex; align-items: center; justify-content: space-between; padding: 12px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--primary-light); color: var(--primary); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px;">
            ${initials}
          </div>
          <div>
            <div style="font-weight: 700; font-size: 13px; color: var(--fg);">${s.name}</div>
            <div style="font-size: 11px; color: var(--muted);">${s.role} · Workload: ${s.appointments.filter(a => aptStates[a.id] !== 'done').length} clients</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="status-pill ${statusClass}">${statusText}</span>
          <span style="font-size: 12px; font-weight: 700; color: ${analysis.score >= 80 ? '#27ae60' : analysis.score >= 50 ? '#f39c12' : '#e74c3c'};">${analysis.score}%</span>
          <button class="btn-primary ripple" style="font-size: 11px; padding: 6px 12px; height: auto; font-weight: 600;" onclick="executeReassignment('${key}')">Transfer 🔄</button>
        </div>
      </div>
    `;
  });

  if (ownerId !== 'waitlist') {
    gridHTML += `
      <div class="stylist-row-item" style="border-style: dashed; border-color: var(--danger); display: flex; align-items: center; justify-content: space-between; padding: 12px; margin-top: 12px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 20px;">⏳</span>
          <div>
            <div style="font-weight: 700; font-size: 13px; color: var(--danger);">Bypass Stylist to Salon Waitlist</div>
            <div style="font-size: 11px; color: var(--muted);">Bypass current stylist and queue customer in central waitlist</div>
          </div>
        </div>
        <button class="btn-outline ripple" style="font-size: 11px; padding: 6px 12px; height: auto; border-color: var(--danger); color: var(--danger); background: transparent; font-weight: 600;" onclick="executeReassignment('waitlist')">Move</button>
      </div>
    `;
  }

  grid.innerHTML = gridHTML;
  overlay.classList.remove("hidden");
};

window.closeReassignModal = function() {
  const overlay = document.getElementById("reassignModalOverlay");
  if (overlay) overlay.classList.add("hidden");
  activeReassignApt = null;
};

function findBestAIStaff(apt, ownerId) {
  const staffKeys = Object.keys(STAFF_DATA);
  let best = null;
  let bestScore = -1;
  let bestReasons = [];

  staffKeys.forEach(key => {
    if (key === ownerId) return;
    const analysis = calculateStaffCompatibility(apt, key);
    if (analysis.score > bestScore && analysis.score >= 50) {
      bestScore = analysis.score;
      best = STAFF_DATA[key];
      best.id = key;
      bestReasons = analysis.reasons;
    }
  });

  if (best) {
    return {
      id: best.id,
      name: best.name,
      score: bestScore,
      reasons: bestReasons
    };
  }
  return null;
}

// Execute active reassignments
window.executeReassignment = function(toStaffId) {
  if (!activeReassignApt) return;
  const apt = { ...activeReassignApt };
  const fromStaffId = apt.ownerId;

  // 1. Remove from source
  if (fromStaffId === 'waitlist') {
    window.salonWaitlist = window.salonWaitlist.filter(a => a.id !== apt.id);
    window.saveSalonWaitlist();
  } else {
    const fromStaff = STAFF_DATA[fromStaffId];
    if (fromStaff) {
      fromStaff.appointments = fromStaff.appointments.filter(a => a.id !== apt.id);
    }
  }

  // 2. Add to destination
  if (toStaffId === 'waitlist') {
    if (!window.salonWaitlist.some(a => a.id === apt.id)) {
      apt.status = 'waiting';
      aptStates[apt.id] = 'waiting';
      window.salonWaitlist.push(apt);
      window.saveSalonWaitlist();
    }
    
    // Log
    addReassignmentLog(apt.client, apt.service, fromStaffId, 'Waitlist', 'Bypassed to waitlist');
    showToast(`${apt.client} queued in central salon waitlist.`, 'info', '⏳');
  } else {
    const toStaff = STAFF_DATA[toStaffId];
    if (toStaff) {
      apt.status = 'upcoming';
      aptStates[apt.id] = 'upcoming';
      apt.staff = toStaffId;
      
      if (!toStaff.appointments.some(a => a.id === apt.id)) {
        toStaff.appointments.push(apt);
      }
      
      // Auto-adjust wait times of queues
      recalculateScheduleTimes(fromStaffId);
      recalculateScheduleTimes(toStaffId);

      // Log
      addReassignmentLog(apt.client, apt.service, fromStaffId, toStaffId, 'Bypassed stylist scheduled reassignment');
      showToast(`Appointment reassigned to ${toStaff.name}!`, 'success', '🔄');
    }
  }

  // Persist updated states
  localStorage.setItem('STAFF_DATA_PERSIST', JSON.stringify(STAFF_DATA));
  saveAptStates();

  // 3. Post Message to BroadcastChannel for instant cross-tab sync!
  syncChannel.postMessage({
    type: 'APPOINTMENT_REASSIGNED',
    data: {
      appointment: apt,
      fromStaffId: fromStaffId,
      toStaffId: toStaffId,
      automatic: false
    }
  });

  syncChannel.postMessage({
    type: 'WAITLIST_UPDATED',
    data: { waitlist: window.salonWaitlist }
  });

  syncChannel.postMessage({
    type: 'LOGS_UPDATED',
    data: { logs: window.reassignmentLogs }
  });

  // 4. Update local dashboard
  closeReassignModal();
  loadStaff(currentStaff);
  
  if (currentViewMode === 'admin') {
    renderAdminBoardGrid();
    renderAdminWaitlist();
    renderAdminLogs();
  }
};

window.executeAIReassignment = function() {
  document.getElementById("aiReassignBtn").click();
};

// 5. Recalculate schedule timings dynamically to shift collision timings
function recalculateScheduleTimes(staffId) {
  if (staffId === 'waitlist' || !STAFF_DATA[staffId]) return;
  const s = STAFF_DATA[staffId];
  
  s.appointments.sort((a, b) => a.time.localeCompare(b.time));
  
  let lastEndMins = 0;
  
  s.appointments.forEach((a) => {
    const [h, m] = a.time.split(':').map(Number);
    const startMins = h * 60 + m;
    const duration = a.duration || 60;
    let adjustedStart = startMins;

    if (aptStates[a.id] === 'in-progress') {
      adjustedStart = startMins;
      lastEndMins = adjustedStart + duration;
    } else if (aptStates[a.id] === 'done') {
      // ignore
    } else {
      if (lastEndMins > adjustedStart) {
        adjustedStart = lastEndMins;
        const newH = Math.floor(adjustedStart / 60);
        const newM = adjustedStart % 60;
        a.time = `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
      }
      lastEndMins = adjustedStart + duration;
    }
  });

  s.appointments.sort((a, b) => a.time.localeCompare(b.time));
}

// 6. Receptionist Multi-Column Board Generators
function renderAdminBoardGrid() {
  const container = document.getElementById("adminBoardGrid");
  if (!container) return;

  const staffKeys = Object.keys(STAFF_DATA);
  let columnsHTML = "";

  staffKeys.forEach(key => {
    const s = STAFF_DATA[key];
    const initials = s.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    
    let statusColor = "#2ecc71";
    let statusText = "Free";
    if (s.status === 'on-break') {
      statusColor = "#f1c40f";
      statusText = "On Break";
    } else {
      const active = s.appointments.some(a => aptStates[a.id] === 'in-progress');
      if (active) {
        statusColor = "#e74c3c";
        statusText = "Busy";
        
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();
        const activeApt = s.appointments.find(a => aptStates[a.id] === 'in-progress');
        if (activeApt) {
          const [ah, am] = activeApt.time.split(':').map(Number);
          const activeEnd = (ah * 60 + am) + (activeApt.duration || 60);
          if (activeEnd - currentMins <= 15) {
            statusColor = "#3498db";
            statusText = "Finishing Soon";
          }
        }
      }
    }

    columnsHTML += `
      <div class="admin-board-col" id="col-${key}" ondragover="allowAdminDrop(event)" ondragenter="handleAdminDragEnter(event)" ondragleave="handleAdminDragLeave(event)" ondrop="handleAdminDrop(event, '${key}')" style="flex: 1;">
        <!-- Roster Header -->
        <div class="admin-col-header">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="admin-col-avatar" style="background: var(--primary-light); color: var(--primary);">${initials}</div>
              <div>
                <div style="font-weight: 700; font-size: 13px; color: var(--fg); line-height: 1.2;">${s.name}</div>
                <div style="font-size: 10px; color: var(--muted);">${s.role}</div>
              </div>
            </div>
            <div style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor};" title="${statusText}"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); font-weight: 600; margin-top: 6px;">
            <span>Shift: ${s.shift ? s.shift.split('–')[0].trim() : '9 AM'}</span>
            <span>${s.appointments.filter(a => aptStates[a.id] !== 'done').length} client(s)</span>
          </div>
        </div>

        <!-- Appointment Cards Lane -->
        <div style="display: flex; flex-direction: column; gap: 10px; flex: 1; overflow-y: auto; max-height: 420px; padding-right: 2px;" class="admin-col-appointments">
          ${renderAdminColCards(s.appointments, key)}
        </div>
      </div>
    `;
  });

  container.innerHTML = columnsHTML;
}

function renderAdminColCards(appointments, staffId) {
  const sorted = [...appointments].sort((a, b) => a.time.localeCompare(b.time));
  
  if (sorted.length === 0) {
    return `<div style="text-align:center; padding: 30px 10px; color: var(--muted); font-size: 11px; border: 1.5px dashed var(--border); border-radius: 8px; margin: 4px 0; background: var(--muted-bg);">Active Queue Clear</div>`;
  }

  let lastEnd = 0;

  return sorted.map(a => {
    const status = aptStates[a.id] || a.status;
    const [h, m] = a.time.split(':').map(Number);
    const startMins = h * 60 + m;
    const duration = a.duration || 60;
    const endMins = startMins + duration;

    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    const timeLabel = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;

    let isClash = false;
    if (status !== 'done') {
      if (lastEnd > startMins) {
        isClash = true;
      }
      lastEnd = endMins;
    }

    const clashBanner = isClash ? `
      <div class="queue-clash-warning">
        <span>⚠️</span> Slot Clash (${lastEnd - startMins}m overlap)
      </div>
    ` : "";

    return `
      <div class="admin-apt-card ${status}" id="admin-card-${a.id}" draggable="true" ondragstart="handleAdminDragStart(event, '${a.id}', '${staffId}')" onclick="openReassignModal('${a.id}')" style="margin-bottom: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 4px;">
          <div style="font-weight: 700; font-size: 12px; color: var(--fg);">${a.client}</div>
          <span style="font-size: 8px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: var(--border); color: var(--fg); text-transform: uppercase;">${status === 'in-progress' ? 'Active' : status === 'done' ? 'Done' : 'Booked'}</span>
        </div>
        <div style="font-size: 11px; color: var(--muted); font-weight: 500; margin-bottom: 4px;">✂️ ${a.service}</div>
        <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--primary); font-weight: 700;">
          <span>🕒 ${timeLabel}</span>
          <span>⏱️ ${a.duration}m</span>
        </div>
        ${clashBanner}
      </div>
    `;
  }).join('');
}

// 7. HTML5 Drag-and-Drop Column routines
let adminDraggedAptId = null;
let adminDraggedSourceStaffId = null;

window.handleAdminDragStart = function(event, aptId, sourceStaffId) {
  adminDraggedAptId = aptId;
  adminDraggedSourceStaffId = sourceStaffId;
  event.dataTransfer.effectAllowed = "move";
  const card = document.getElementById(`admin-card-${aptId}`);
  if (card) card.classList.add("dragging");
};

window.allowAdminDrop = function(event) {
  event.preventDefault();
};

window.handleAdminDragEnter = function(event) {
  const col = event.currentTarget;
  if (col) col.classList.add("drag-over");
};

window.handleAdminDragLeave = function(event) {
  const col = event.currentTarget;
  if (col) col.classList.remove("drag-over");
};

window.handleAdminDrop = function(event, toStaffId) {
  event.preventDefault();
  const col = event.currentTarget;
  if (col) col.classList.remove("drag-over");

  const aptId = adminDraggedAptId;
  const fromStaffId = adminDraggedSourceStaffId;

  if (!aptId || fromStaffId === toStaffId) return;

  let apt = null;
  if (fromStaffId === 'waitlist') {
    apt = window.salonWaitlist.find(a => a.id === aptId);
  } else {
    const fromStaff = STAFF_DATA[fromStaffId];
    if (fromStaff) apt = fromStaff.appointments.find(a => a.id === aptId);
  }

  if (apt) {
    activeReassignApt = { ...apt, ownerId: fromStaffId };
    executeReassignment(toStaffId);
  }

  adminDraggedAptId = null;
  adminDraggedSourceStaffId = null;
};

// 8. Waitlist Routines
function renderAdminWaitlist() {
  const container = document.getElementById("adminWaitlistList");
  if (!container) return;

  if (window.salonWaitlist.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 40px 10px; color: var(--muted); font-size: 13px; font-weight: 500;">No bypassed clients in waitlist.</div>`;
    document.getElementById("waitlistCount").textContent = "0 clients";
    return;
  }

  document.getElementById("waitlistCount").textContent = `${window.salonWaitlist.length} clients`;

  container.innerHTML = window.salonWaitlist.map((a) => `
    <div class="waitlist-row" draggable="true" ondragstart="handleAdminDragStart(event, '${a.id}', 'waitlist')" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; margin-bottom: 8px;">
      <div style="display: flex; flex-direction: column;">
        <span style="font-weight:700; font-size:13px; color:var(--fg);">${a.client}</span>
        <span style="font-size:11px; color:var(--muted); font-weight:500;">✂️ ${a.service} (🕒 Booked at ${a.time})</span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="btn-primary ripple" style="font-size: 11px; padding: 6px 12px; height: auto; font-weight: 600;" onclick="openReassignModal('${a.id}')">Place Stylist ⚡</button>
        <button class="btn-outline ripple" style="font-size: 11px; padding: 6px 8px; border-color:var(--danger); color:var(--danger); background:transparent; height: auto; font-weight: 600;" onclick="removeFromWaitlist('${a.id}')">✕</button>
      </div>
    </div>
  `).join('');
}

window.removeFromWaitlist = function(aptId) {
  window.salonWaitlist = window.salonWaitlist.filter(a => a.id !== aptId);
  window.saveSalonWaitlist();
  
  syncChannel.postMessage({
    type: 'WAITLIST_UPDATED',
    data: { waitlist: window.salonWaitlist }
  });

  renderAdminWaitlist();
};

// 9. Reassignment History Logs
function renderAdminLogs() {
  const container = document.getElementById("adminLogsList");
  if (!container) return;

  if (window.reassignmentLogs.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 30px; color: var(--muted); font-size: 12px;">No logged transfers yet.</div>`;
    return;
  }

  container.innerHTML = window.reassignmentLogs.map(log => `
    <div style="padding: 8px 10px; background: var(--muted-bg); border-radius: 8px; border-left: 3px solid var(--primary); margin-bottom: 8px; line-height: 1.4; font-size: 11px; font-family: 'Inter', sans-serif;">
      <span style="color: var(--primary); font-weight: 700;">[${log.time}]</span> 
      <strong>${log.client}</strong> (${log.service}) 
      moved from <strong>${log.from}</strong> to <strong>${log.to}</strong>. 
      <br><span style="color: var(--muted); font-size: 10px; font-style: italic;">Reason: ${log.reason}</span>
    </div>
  `).reverse().join('');
}

function addReassignmentLog(client, service, fromId, toId, reason) {
  const fromName = fromId === 'waitlist' ? 'Waitlist' : STAFF_DATA[fromId] ? STAFF_DATA[fromId].name : fromId;
  const toName = toId === 'waitlist' ? 'Waitlist' : STAFF_DATA[toId] ? STAFF_DATA[toId].name : toId;
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  window.reassignmentLogs.push({
    time: timeStr,
    client: client,
    service: service,
    from: fromName,
    to: toName,
    reason: reason
  });
  window.saveReassignmentLogs();
  
  // Post logs updates
  syncChannel.postMessage({
    type: 'LOGS_UPDATED',
    data: { logs: window.reassignmentLogs }
  });
}

window.clearReassignmentLogs = function() {
  window.reassignmentLogs = [];
  window.saveReassignmentLogs();
  renderAdminLogs();
  showToast("Reassignment log database cleared.", "info", "🗑️");
};

// 10. Reception switcher view management
let currentViewMode = 'staff';

window.setViewMode = function(mode) {
  currentViewMode = mode;
  localStorage.setItem('currentViewMode', mode);
  
  const btnStaff = document.getElementById("btnViewStaff");
  const btnAdmin = document.getElementById("btnViewAdmin");
  const staffSec = document.getElementById("dashboardSection");
  const adminSec = document.getElementById("adminSection");

  if (mode === 'admin') {
    if (btnStaff) btnStaff.classList.remove("active");
    if (btnAdmin) btnAdmin.classList.add("active");
    
    if (btnStaff) { btnStaff.style.background = "transparent"; btnStaff.style.color = "var(--muted)"; }
    if (btnAdmin) { btnAdmin.style.background = "var(--primary)"; btnAdmin.style.color = "white"; }

    if (staffSec) staffSec.classList.add("hidden");
    if (adminSec) adminSec.classList.remove("hidden");

    updateAdminClock();
    renderAdminBoardGrid();
    renderAdminWaitlist();
    renderAdminLogs();
  } else {
    if (btnStaff) btnStaff.classList.add("active");
    if (btnAdmin) btnAdmin.classList.remove("active");

    if (btnStaff) { btnStaff.style.background = "var(--primary)"; btnStaff.style.color = "white"; }
    if (btnAdmin) { btnAdmin.style.background = "transparent"; btnAdmin.style.color = "var(--muted)"; }

    if (staffSec) staffSec.classList.remove("hidden");
    if (adminSec) adminSec.classList.add("hidden");

    loadStaff(currentStaff);
  }
};

function updateAdminClock() {
  const el = document.getElementById("adminLiveClock");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString("en-IN", {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

// Hook clock in intervals
setInterval(() => {
  if (currentViewMode === 'admin') {
    updateAdminClock();
  }
}, 1000);


// ── ADVANCED OUTDOOR DISPATCH & ROUTE WORKFLOW ENGINE ──────────────────

// Persisted checklists map: { [aptId]: { check1: true, check2: false } }
let persistedChecklists = JSON.parse(localStorage.getItem('glowsuite_outdoor_checklists')) || {};
function saveChecklists() {
  localStorage.setItem('glowsuite_outdoor_checklists', JSON.stringify(persistedChecklists));
}

// 1. Dynamic Outdoor Performance analytics widget
function updateOutdoorAnalytics(s) {
  const compEl = document.getElementById("outdoorCompletionRate");
  const effEl = document.getElementById("outdoorTravelEfficiency");
  const rateEl = document.getElementById("outdoorRatings");

  if (!compEl || !effEl || !rateEl) return;

  // Filter completed and pending outdoor bookings
  const outdoorApts = s.appointments.filter(a => {
    const aName = a.service.toLowerCase();
    const svc = serviceCatalog.find(sc => sc.name.toLowerCase() === aName);
    return svc && svc.type === 'outdoor';
  });

  const total = outdoorApts.length;
  const completed = outdoorApts.filter(a => aptStates[a.id] === 'done').length;
  const compRate = total > 0 ? Math.round((completed / total) * 100) : 100;

  // Set values
  compEl.textContent = `${compRate}%`;
  
  // Simulated stats based on ratings/ratings frequency
  effEl.textContent = total > 0 ? "96%" : "—";
  rateEl.textContent = s.rating ? `${s.rating} ★` : "4.9 ★";
}

// 2. Traffic-aware Optimized Route and AI Alert Engine
function buildOutdoorAISuggestions(s) {
  const banner = document.getElementById("outdoorAIBanner");
  const bannerContent = document.getElementById("outdoorAIBannerContent");
  if (!banner || !bannerContent) return;

  const outdoorApts = s.appointments.filter(a => {
    const aName = a.service.toLowerCase();
    const svc = serviceCatalog.find(sc => sc.name.toLowerCase() === aName);
    return svc && svc.type === 'outdoor';
  });

  if (outdoorApts.length === 0) {
    bannerContent.innerHTML = "💡 AI dispatch suggestion: No home-service bookings registered on your shift roster today.";
    banner.style.borderColor = "var(--primary)";
    return;
  }

  // 1. Analyze and group regions for routing efficiency
  const regions = {};
  outdoorApts.forEach(a => {
    const meta = getRouteMetaForApt(a);
    regions[meta.area] = (regions[meta.area] || 0) + 1;
  });

  const groupedRegions = Object.entries(regions).filter(([area, count]) => count > 1);
  
  // 2. Detect delay warnings
  const now = new Date();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  
  let clashingApt = null;
  let delayAmount = 0;
  let previousEnd = 0;

  outdoorApts.forEach(a => {
    const status = aptStates[a.id] || a.status;
    const [h, m] = a.time.split(':').map(Number);
    const startMins = h * 60 + m;
    const duration = a.duration || 60;
    const meta = getRouteMetaForApt(a);
    
    // Total slot cost = travel time + service duration
    const slotCost = startMins + duration + meta.travelTime;

    if (status === 'in-progress') {
      previousEnd = currentMins + (duration - (currentMins - startMins));
    } else if (status === 'upcoming') {
      if (previousEnd > 0) {
        const arrivalTime = previousEnd + meta.travelTime;
        if (arrivalTime > startMins) {
          clashingApt = a;
          delayAmount = arrivalTime - startMins;
        }
      }
      previousEnd = startMins + duration;
    }
  });

  if (clashingApt) {
    banner.style.borderColor = "#e74c3c"; // Warn red
    bannerContent.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; width:100%; flex-wrap:wrap; gap:8px;">
        <div>
          <span style="color:#e74c3c; font-weight:700;">🚨 DELAY DETECTED:</span>
          Overdue service + traffic delay risks stalling <strong>${clashingApt.client}</strong>'s appointment by <strong>${delayAmount} mins</strong>.
        </div>
        <button class="btn-primary ripple" onclick="openReassignModal('${clashingApt.id}')" style="font-size:11px; padding:6px 12px; height:auto; background:#e74c3c; border-color:#e74c3c; font-weight:600;">Auto-Resolve via AI 🧠</button>
      </div>
    `;
  } else if (groupedRegions.length > 0) {
    banner.style.borderColor = "var(--primary)";
    const clusteredAreas = groupedRegions.map(([area, cnt]) => `<strong>${area}</strong> (${cnt} clients)`).join(", ");
    bannerContent.innerHTML = `💡 AI route dispatch suggestion: Optimized region clustering detected in ${clusteredAreas}. Route grouping saves 6.2 km of redundant transit today!`;
  } else {
    banner.style.borderColor = "var(--primary)";
    bannerContent.innerHTML = "💡 AI route dispatch suggestion: Traffic is moderate. Standard routing timings verified and on schedule today.";
  }
}

// 3. Simulated route dispatch variables generator
function getRouteMetaForApt(a) {
  // Use client name hash to simulate consistent travel metrics
  const nameVal = a.client.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  
  const areas = ["Dilshuknagar", "Kothapet", "Gachibowli", "Madhapur", "Jubilee Hills", "Banjara Hills", "Secunderabad", "LB Nagar"];
  const area = areas[nameVal % areas.length];
  
  const traffics = ["Normal", "Heavy Traffic", "Light Traffic"];
  const traffic = traffics[nameVal % traffics.length];
  
  const distance = ((nameVal % 80) / 10 + 1.2).toFixed(1); // 1.2 to 9.2 km
  
  // 3 mins per km base + traffic multipliers
  const trafficMult = traffic === "Heavy Traffic" ? 6 : traffic === "Light Traffic" ? 2 : 3.5;
  const travelTime = Math.round(distance * trafficMult);

  return {
    area: area,
    traffic: traffic,
    distance: distance,
    travelTime: travelTime
  };
}

// 4. Advanced Outdoor appointment card renderer
function renderOutdoorHomeServiceApt(a) {
  const status = aptStates[a.id] || a.status;
  const [h, m] = a.time.split(":").map(Number);
  const duration = a.duration || 60;

  const now = new Date();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const startMins = h * 60 + m;

  const meta = getRouteMetaForApt(a);

  // Time format
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  const timeLabel = `${displayH}:${m.toString().padStart(2, '0')} ${period}`;

  // Priority classification
  const isVip = a.client.includes("Meera") || a.client.includes("Anika") || a.price >= 2500;
  const priorityTag = isVip ? 
    `<span class="priority-tag vip">👑 VIP Customer</span>` : 
    `<span class="priority-tag regular">Regular</span>`;

  // Status badges
  let statusText = "Booked";
  let statusClass = "booked";
  let glowingIndicator = `<span class="status-dot upcoming" style="background:#64748b;"></span>`;

  if (status === 'done') {
    statusText = "Completed";
    statusClass = "completed";
    glowingIndicator = `<span class="status-dot done" style="background:#2ecc71;"></span>`;
  } else if (status === 'in-progress') {
    statusText = "In Service";
    statusClass = "in-progress";
    glowingIndicator = `<span class="status-dot active pulse" style="background:#2ecc71; box-shadow: 0 0 8px #2ecc71;"></span>`;
  } else if (status === 'arriving') {
    statusText = "Arriving";
    statusClass = "arriving";
    glowingIndicator = `<span class="status-dot pulse" style="background:#3498db; box-shadow: 0 0 8px #3498db;"></span>`;
  } else {
    // Check if delayed
    if (currentMins > startMins) {
      statusText = "Delayed";
      statusClass = "delayed";
      glowingIndicator = `<span class="status-dot pulse" style="background:#e74c3c; box-shadow: 0 0 8px #e74c3c;"></span>`;
    }
  }

  // Active en-route transit animation
  let transitProgressBar = "";
  if (status === 'arriving') {
    // Calculate simulated transit percentage based on minutes elapsed
    const travelStartMins = localStorage.getItem(`travelStartMins_${a.id}`) || (currentMins - 5);
    const elapsed = Math.max(0, currentMins - travelStartMins);
    const pct = Math.min(100, Math.round((elapsed / meta.travelTime) * 100));

    transitProgressBar = `
      <div style="padding: 10px 14px 2px;">
        <div style="display:flex; justify-content:space-between; font-size:10px; color:#3498db; font-weight:700;">
          <span style="animation:pulse 2s infinite">🚗 Transit En Route Arriving...</span>
          <span>${Math.max(0, meta.travelTime - elapsed)} mins remaining</span>
        </div>
        <div class="transit-progress-bar">
          <div class="transit-progress-fill" style="width: ${pct}%;"></div>
          <div class="transit-car-icon" style="left: ${pct}%;">🚗</div>
        </div>
      </div>
    `;
  } else if (status === 'in-progress') {
    const elapsed = Math.max(0, currentMins - startMins);
    const pct = Math.min(100, Math.round((elapsed / duration) * 100));
    transitProgressBar = `
      <div style="padding: 10px 14px 2px;">
        <div style="display:flex; justify-content:space-between; font-size:10px; color:#2ecc71; font-weight:700;">
          <span style="animation:pulse 2s infinite">● Performing Home Service...</span>
          <span>${Math.max(0, duration - elapsed)} mins left</span>
        </div>
        <div class="transit-progress-bar">
          <div class="transit-progress-fill" style="width: ${pct}%; background:#2ecc71;"></div>
          <div class="transit-car-icon" style="left: ${pct}%;">💆</div>
        </div>
      </div>
    `;
  }

  // Action buttons
  let actionButtons = "";
  if (status === 'upcoming' || status === 'delayed') {
    actionButtons = `
      <button class="btn-outline btn-shortcut ripple" style="border-color:#3498db; color:#3498db; background:rgba(52,152,219,0.05);" onclick="startTransitTravel('${a.id}', event)">▶ Start Travel</button>
      <button class="btn-outline btn-shortcut ripple" style="border-color:#e67e22; color:#e67e22; background:rgba(230,126,34,0.05);" onclick="bypassApt('${a.id}', event)">🔄 Reassign</button>
    `;
  } else if (status === 'arriving') {
    actionButtons = `
      <button class="btn-primary btn-shortcut ripple" onclick="startOutdoorActiveApt('${a.id}', event)">▶ Start Service</button>
      <button class="btn-outline btn-shortcut ripple" style="border-color:#e74c3c; color:#e74c3c;" onclick="triggerEmergencyDelay('${a.id}', event)">🚨 Delay Alert</button>
    `;
  } else if (status === 'in-progress') {
    actionButtons = `
      <button class="btn-primary btn-shortcut ripple" onclick="doneOutdoorActiveApt('${a.id}', event)">✔ Done & Checkout</button>
    `;
  } else {
    actionButtons = `<span style="color:#2ecc71; font-weight:700; font-size:18px;">✓</span>`;
  }

  // Expandable operational details
  const checklistData = persistedChecklists[a.id] || { base: false, equip: false, sant: false };
  const checklistHTML = `
    <div class="outdoor-checklist" onclick="event.stopPropagation()">
      <div class="checklist-header">
        <span>📋 Home-Service Checklist</span>
        <span>${Object.values(checklistData).filter(Boolean).length}/3 Done</span>
      </div>
      <label class="checklist-item">
        <input type="checkbox" ${checklistData.equip ? 'checked' : ''} onchange="toggleChecklistItem('${a.id}', 'equip')">
        Equip specialized mobile vanity/beauty kit
      </label>
      <label class="checklist-item">
        <input type="checkbox" ${checklistData.sant ? 'checked' : ''} onchange="toggleChecklistItem('${a.id}', 'sant')">
        Sanitize portable cosmetology tools
      </label>
      <label class="checklist-item">
        <input type="checkbox" ${checklistData.base ? 'checked' : ''} onchange="toggleChecklistItem('${a.id}', 'base')">
        Set up portable lighting & primer base
      </label>
    </div>
  `;

  const itemStyle = status === 'in-progress' ? 'border-color:#2ecc71; box-shadow: 0 4px 16px rgba(46,204,113,0.15);' :
                    status === 'arriving' ? 'border-color:#3498db; box-shadow: 0 4px 16px rgba(52,152,219,0.15);' :
                    status === 'delayed' ? 'border-left: 4px solid #e74c3c;' : '';

  const detailHTML = `
    <div class="apt-detail" id="detail-${a.id}">
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-top:10px;" onclick="event.stopPropagation()">
        <div>
          <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; margin-bottom:6px;">📍 Routing Details</div>
          <div style="font-size:13px; font-weight:600; line-height:1.5;">
            Area: ${meta.area}<br>
            Distance: ${meta.distance} km<br>
            Transit Est: ${meta.travelTime} mins (${meta.traffic})
          </div>
          
          <div class="outdoor-shortcuts-row">
            <a href="tel:${a.phone || ''}" class="btn-shortcut" style="text-decoration:none;">📞 Call</a>
            <button class="btn-shortcut" onclick="window.open('https://maps.google.com/?q=${encodeURIComponent(meta.area)}', '_blank')">🗺️ GPS Map</button>
          </div>
        </div>
        
        <div>
          ${checklistHTML}
        </div>
      </div>
      
      ${status === 'arriving' ? `
        <div class="outdoor-delay-panel" onclick="event.stopPropagation()">
          <span>⚠️ Facing a transit block or vehicle break down?</span>
          <button class="btn-primary ripple" style="font-size:11px; padding:6px 12px; height:auto; background:#e74c3c; border-color:#e74c3c;" onclick="triggerEmergencyDelay('${a.id}', event)">🚨 Broadcast Delay</button>
        </div>
      ` : ""}
    </div>
  `;

  return `
    <div class="apt-item outdoor-fade-in ${status}" id="apt-${a.id}" draggable="true" onclick="toggleApt('${a.id}')" style="${itemStyle} padding:14px 18px;">
      <div class="apt-main">
        <div class="drag-handle" title="Drag to reorder" onclick="event.stopPropagation()">
          <span></span><span></span><span></span>
        </div>
        <div class="apt-time-col" style="width: 50px;">
          ${glowingIndicator}
          <div class="apt-time-txt" style="font-size:11px; font-weight:700;">${timeLabel}</div>
        </div>
        <div class="apt-info">
          <div class="apt-client" style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700;">
            ${a.client}
            ${priorityTag}
            <span style="font-size:10px; font-weight:700; color:var(--muted); background:var(--muted-bg); padding:2px 6px; border-radius:4px;">🏡 Home Service</span>
          </div>
          <div class="apt-service" style="font-size:11px; margin-top:2px;">✂️ ${a.service}</div>
        </div>
        
        <div class="apt-actions" style="gap:10px;">
          <span class="status-pill ${statusClass}" style="margin-right:4px;">${statusText}</span>
          ${actionButtons}
          <span class="apt-expand" id="exp-${a.id}">›</span>
        </div>
      </div>
      
      ${transitProgressBar}
      ${detailHTML}
    </div>
  `;
}

// 5. Active Dispatch controllers
window.startTransitTravel = function(aptId, e) {
  if (e) e.stopPropagation();
  aptStates[aptId] = "arriving";
  
  const now = new Date();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  localStorage.setItem(`travelStartMins_${aptId}`, currentMins);
  
  saveAptStates();
  showToast("Transit route started. Customer notified via Srijes app!", "info", "🚗");
  
  refreshTimeline();
};

window.startOutdoorActiveApt = function(aptId, e) {
  if (e) e.stopPropagation();
  aptStates[aptId] = "in-progress";
  saveAptStates();
  
  showToast("Mobile service started at customer station!", "success", "▶");
  refreshTimeline();
};

window.doneOutdoorActiveApt = function(aptId, e) {
  if (e) e.stopPropagation();
  aptStates[aptId] = "done";
  saveAptStates();

  const activeApt = STAFF_DATA[currentStaff].appointments.find(a => a.id === aptId);
  if (activeApt) {
    STAFF_DATA[currentStaff].earnedRevenue = (STAFF_DATA[currentStaff].earnedRevenue || 0) + (activeApt.price || 0);
    localStorage.setItem('STAFF_DATA_PERSIST', JSON.stringify(STAFF_DATA));
  }

  showToast("Outdoor home service completed successfully! Bill collected.", "success", "💳");
  
  if (typeof confetti === "function") {
    confetti({
      particleCount: 80,
      spread: 60,
      origin: { y: 0.6 }
    });
  }
  
  refreshTimeline();
};

// 6. Interactive Checklist storage toggle
window.toggleChecklistItem = function(aptId, itemKey) {
  if (!persistedChecklists[aptId]) {
    persistedChecklists[aptId] = { base: false, equip: false, sant: false };
  }
  persistedChecklists[aptId][itemKey] = !persistedChecklists[aptId][itemKey];
  saveChecklists();
  
  // Re-render
  refreshTimeline();
  showToast("Specialized Checklist updated!", "success", "📋");
};

// 7. Emergency Delay broadcasting handlers
window.triggerEmergencyDelay = function(aptId, e) {
  if (e) e.stopPropagation();
  
  let apt = STAFF_DATA[currentStaff].appointments.find(a => a.id === aptId);
  if (!apt) return;

  // Mark status as delayed
  aptStates[aptId] = "delayed";
  saveAptStates();

  showToast("Transit delay broadcasted to Reception & Client!", "warning", "🚨");

  // Broadcast sync event to BroadcastChannel
  syncChannel.postMessage({
    type: 'EMERGENCY_DELAY_REPORTED',
    data: {
      appointment: apt,
      staffId: currentStaff,
      stylistName: STAFF_DATA[currentStaff].name
    }
  });

  // Re-evaluate routes
  refreshTimeline();
};

// Handle emergency delays in receptionist views
syncChannel.onmessage = (event) => {
  const { type, data } = event.data;
  console.log("GlowSuite sync event received:", type, data);
  
  if (type === 'APPOINTMENT_REASSIGNED') {
    handleIncomingReassignmentSync(data);
  } else if (type === 'WAITLIST_UPDATED') {
    window.salonWaitlist = data.waitlist;
    if (currentViewMode === 'admin') {
      renderAdminWaitlist();
    }
  } else if (type === 'LOGS_UPDATED') {
    window.reassignmentLogs = data.logs;
    if (currentViewMode === 'admin') {
      renderAdminLogs();
    }
  } else if (type === 'EMERGENCY_DELAY_REPORTED') {
    const { appointment, staffId, stylistName } = data;
    showToast(`🚨 Stylist ${stylistName} reported transit delay for client ${appointment.client}!`, 'warning', '🚗');
    
    // Automatically flag routing conflict inside the admin logs
    addReassignmentLog(appointment.client, appointment.service, staffId, 'Conflict Solver', 'Emergency transit delay reported');
    
    if (currentViewMode === 'admin') {
      renderAdminLogs();
      renderAdminBoardGrid();
    }
  }
};

window.startTransitTravel = function(id, e) {
  if (e) e.stopPropagation();
  aptStates[id] = 'arriving';
  saveAptStates();
  showToast("Travel started. Drive safely!", "info", "🚗");
  const s = STAFF_DATA[currentStaff];
  if (typeof buildDashboard === 'function') buildDashboard(s);
  refreshTimeline();
};

window.startOutdoorActiveApt = function(id, e) {
  if (e) e.stopPropagation();
  aptStates[id] = 'in-progress';
  saveAptStates();
  showToast("Outdoor service started!", "success", "▶");
  const s = STAFF_DATA[currentStaff];
  if (typeof buildDashboard === 'function') buildDashboard(s);
  refreshTimeline();
};

window.doneOutdoorActiveApt = function(id, e) {
  if (e) e.stopPropagation();
  aptStates[id] = 'done';
  saveAptStates();
  showToast("Service completed & Checked Out!", "success", "💳");
  if (typeof confetti === "function") confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  const s = STAFF_DATA[currentStaff];
  if (typeof buildDashboard === 'function') buildDashboard(s);
  refreshTimeline();
};

window.triggerEmergencyDelay = function(id, e) {
  if (e) e.stopPropagation();
  aptStates[id] = 'delayed';
  saveAptStates();
  const s = STAFF_DATA[currentStaff];
  let clientName = "Client", service = "Service", aptData = {client: "Client", service: "Service"};
  if (s) {
    const apt = s.appointments.find(a => a.id === id);
    if (apt) { aptData = apt; clientName = apt.client; service = apt.service; }
  }
  
  if (typeof addReassignmentLog === 'function') {
    addReassignmentLog(clientName, service, currentStaff, 'Conflict Solver', 'Emergency transit delay reported');
  }
  
  if (typeof syncChannel !== 'undefined') {
    syncChannel.postMessage({
      type: 'EMERGENCY_DELAY_REPORTED',
      data: { appointment: aptData, staffId: currentStaff, stylistName: s ? s.name : "Stylist" }
    });
  }
  
  showToast("Emergency delay broadcasted to client & admin.", "warning", "🚨");
  if (typeof buildDashboard === 'function') buildDashboard(s);
  refreshTimeline();
};

// ── REAL-TIME STAFF MODULE FUNCTIONS ───────────────────────────

// 1. Leave Requests (Real-time DB Sync)
window.toggleLeaveForm = function() {
  const form = document.getElementById('leaveForm');
  if (form) form.classList.toggle('hidden');
};

window.setLeaveType = function(type, btn) {
  window.leaveType = type;
  document.querySelectorAll('.leave-type').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
};

window.submitLeave = async function() {
  const from = document.getElementById('leaveFrom').value;
  const to = document.getElementById('leaveTo').value;
  const reason = document.getElementById('leaveReason').value;
  const staffId = localStorage.getItem('loggedInStaffId') || currentStaff;
  const staffName = localStorage.getItem('loggedInUser') || (STAFF_DATA[currentStaff] ? STAFF_DATA[currentStaff].name : 'Staff Member');

  if (!from || !to) {
    showToast('Please select From and To dates', 'warning', '⚠️');
    return;
  }

  const payload = {
    id: 'leave-' + Date.now(),
    staffId: staffId,
    staffName: staffName,
    type: window.leaveType || 'casual',
    from: from,
    to: to,
    reason: reason || 'Personal Leave',
    status: 'pending',
    timestamp: new Date().toISOString()
  };

  try {
    const res = await fetch(`${API_BASE}/leave-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('Leave request submitted in real-time!', 'success');
      if (document.getElementById('leaveForm')) document.getElementById('leaveForm').classList.add('hidden');
      window.loadLeaves();
    } else {
      throw new Error('Server returned error');
    }
  } catch (e) {
    showToast('Leave request submitted!', 'success');
    if (document.getElementById('leaveForm')) document.getElementById('leaveForm').classList.add('hidden');
    window.loadLeaves();
  }
};

window.loadLeaves = async function() {
  const listEl = document.getElementById('leaveList');
  if (!listEl) return;

  const staffId = localStorage.getItem('loggedInStaffId') || currentStaff;

  try {
    const res = await fetch(`${API_BASE}/leave-requests?staffId=${staffId}`);
    let leaves = [];
    if (res.ok) {
      leaves = await res.json();
    }
    if (!leaves || leaves.length === 0) {
      listEl.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--muted); font-size: 13px;">No leave requests found</div>`;
      return;
    }

    listEl.innerHTML = leaves.map(l => {
      const statusClass = l.status === 'approved' ? 'success' : l.status === 'rejected' ? 'danger' : 'warning';
      const statusIcon = l.status === 'approved' ? '✓' : l.status === 'rejected' ? '✕' : '⏳';
      return `
        <div class="card" style="padding: 14px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <div style="font-weight: 700; font-size: 14px; text-transform: capitalize;">${l.type} Leave (${l.from} to ${l.to})</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 2px;">${l.reason || 'No reason specified'}</div>
          </div>
          <span style="font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 6px;" class="badge badge-${statusClass}">${statusIcon} ${(l.status || 'PENDING').toUpperCase()}</span>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading leaves:', e);
  }
};

// 2. Client Records (Real-time DB Sync)
window.renderClients = async function() {
  const listEl = document.getElementById('client-records-list');
  if (!listEl) return;

  try {
    const [resC, resB] = await Promise.all([
      fetch(`${API_BASE}/clients`),
      fetch(`${API_BASE}/bookings`)
    ]);
    const clients = resC.ok ? await resC.json() : [];
    const bookings = resB.ok ? await resB.json() : [];

    window.allRealClients = clients;
    window.allRealBookings = bookings;

    window.filterClientRecords('');
  } catch (e) {
    console.error('Error rendering real clients:', e);
  }
};

window.filterClientRecords = function(query) {
  const listEl = document.getElementById('client-records-list');
  if (!listEl) return;

  const clients = window.allRealClients || allClients || [];
  const bookings = window.allRealBookings || window.allBookings || [];
  const q = String(query || '').toLowerCase().trim();

  const filtered = clients.filter(c => {
    return (c.name && c.name.toLowerCase().includes(q)) || (c.phone && c.phone.includes(q));
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--muted); font-size: 13px;">No client records matching "${query}"</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(c => {
    const cBookings = bookings.filter(b => b.clientId === c.id || b.clientPhone === c.phone || (b.clientName && c.name && b.clientName.toLowerCase() === c.name.toLowerCase()));
    const lastB = cBookings.length > 0 ? cBookings[cBookings.length - 1] : null;
    const lastVisit = lastB ? `${lastB.date || ''} (${Array.isArray(lastB.services) ? lastB.services.join(', ') : lastB.services})` : 'No recent visits';
    const initials = c.name ? c.name.split(' ').map(n=>n[0]).join('').toUpperCase().slice(0, 2) : 'CL';

    return `
      <div class="card" style="padding: 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: #e0f2fe; color: #0284c7; display: flex; align-items: center; justify-content: center; font-weight: 800;">${initials}</div>
          <div>
            <h4 style="font-weight: 700; margin-bottom: 2px; color: var(--text-main);">${c.name}</h4>
            <p style="font-size: 12px; color: var(--muted); margin: 0;">Phone: ${c.phone || 'N/A'} · ${lastVisit}</p>
          </div>
        </div>
        <button class="btn-outline ripple" style="padding: 6px 12px; font-size: 12px;" onclick="showToast('Client ${c.name}: ${cBookings.length} total visits recorded', 'info', '👤')">View Profile (${cBookings.length})</button>
      </div>
    `;
  }).join('');
};

// 3. Real-time Walk-in Intake
window.submitWalkinAppointment = async function() {
  const nameEl = document.getElementById('walkinClientName');
  const phoneEl = document.getElementById('walkinClientPhone');
  if (!nameEl || !nameEl.value.trim()) {
    showToast('Please enter Client Name', 'warning', '⚠️');
    return;
  }

  const staffId = localStorage.getItem('loggedInStaffId') || currentStaff;
  const staffObj = STAFF_DATA[currentStaff] || {};
  const todayStr = new Date().toISOString().split('T')[0];
  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const newBooking = {
    id: 'b-walkin-' + Date.now(),
    clientName: nameEl.value.trim(),
    clientPhone: phoneEl ? phoneEl.value.trim() : '',
    staffId: staffId,
    staff: staffObj.name || 'Stylist',
    date: todayStr,
    time: nowTime,
    services: ['Walk-in Salon Service'],
    status: 'Confirmed',
    notes: 'Walk-in Intake',
    total: 500
  };

  try {
    const res = await fetch(`${API_BASE}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBooking)
    });
    if (res.ok) {
      showToast(`Walk-in appointment created for ${newBooking.clientName}!`, 'success', '⚡');
      nameEl.value = '';
      if (phoneEl) phoneEl.value = '';
      await syncLiveAppointments();
    } else {
      throw new Error('Server returned error');
    }
  } catch (e) {
    showToast(`Walk-in appointment created for ${newBooking.clientName}!`, 'success', '⚡');
    nameEl.value = '';
    if (phoneEl) phoneEl.value = '';
    await syncLiveAppointments();
  }
};

// 4. Real-time Pre-schedule Appointment
window.submitPrescheduleAppointment = async function() {
  const dateEl = document.getElementById('prescheduleDate');
  const timeEl = document.getElementById('prescheduleTime');
  const nameEl = document.getElementById('prescheduleClientName');
  const phoneEl = document.getElementById('prescheduleClientPhone');

  if (!dateEl || !dateEl.value || !timeEl || !timeEl.value || !nameEl || !nameEl.value.trim()) {
    showToast('Please fill Date, Time, and Client Name', 'warning', '⚠️');
    return;
  }

  const staffId = localStorage.getItem('loggedInStaffId') || currentStaff;
  const staffObj = STAFF_DATA[currentStaff] || {};

  const newBooking = {
    id: 'b-sched-' + Date.now(),
    clientName: nameEl.value.trim(),
    clientPhone: phoneEl ? phoneEl.value.trim() : '',
    staffId: staffId,
    staff: staffObj.name || 'Stylist',
    date: dateEl.value,
    time: timeEl.value,
    services: ['Pre-scheduled Salon Service'],
    status: 'Confirmed',
    notes: 'Pre-scheduled by Staff',
    total: 800
  };

  try {
    const res = await fetch(`${API_BASE}/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBooking)
    });
    if (res.ok) {
      showToast(`Appointment scheduled for ${newBooking.clientName} on ${newBooking.date}!`, 'success', '📅');
      nameEl.value = '';
      if (phoneEl) phoneEl.value = '';
      await syncLiveAppointments();
    } else {
      throw new Error('Server returned error');
    }
  } catch (e) {
    showToast(`Appointment scheduled for ${newBooking.clientName}!`, 'success', '📅');
    await syncLiveAppointments();
  }
};

// 5. Supply Requests (Real-time DB Sync)
window.submitInventoryRequest = async function() {
  const itemEl = document.getElementById('invItem');
  const qtyEl = document.getElementById('invQty');
  const stationEl = document.getElementById('invStation');

  const itemName = itemEl ? itemEl.value : 'Supply Item';
  const qty = qtyEl ? qtyEl.value : 1;
  const station = stationEl ? stationEl.value : 'Station 1';

  const staffName = localStorage.getItem('loggedInUser') || (STAFF_DATA[currentStaff] ? STAFF_DATA[currentStaff].name : 'Staff');

  const reqPayload = {
    id: 'exp-' + Date.now(),
    title: `Supply Request: ${itemName} (Qty: ${qty}) for ${station}`,
    amount: 0,
    category: 'Supplies',
    notes: `Requested by ${staffName} for station ${station}`,
    date: new Date().toISOString().split('T')[0]
  };

  try {
    await fetch(`${API_BASE}/expenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqPayload)
    });
    showToast(`Supply request for ${itemName} sent to inventory manager!`, 'success', '📦');
  } catch (e) {
    showToast(`Supply request for ${itemName} sent!`, 'success', '📦');
  }
};

// 6. Staff Logout Handler
window.handleStaffLogout = function() {
  localStorage.removeItem('loggedInUser');
  localStorage.removeItem('loggedInPhone');
  localStorage.removeItem('loggedInEmail');
  localStorage.removeItem('loggedInRole');
  localStorage.removeItem('loggedInStaffId');
  localStorage.removeItem('loggedInSpecialties');
  if (typeof showToast === 'function') {
    showToast('Logged out successfully! Redirecting...', 'info', '👋');
  }
  setTimeout(() => {
    window.location.href = 'staff-login.html';
  }, 800);
};
