const fs = require('fs');

let appJs = fs.readFileSync('app.js', 'utf8');

const newSubmitLeave = `function submitLeave() {
  const from = document.getElementById("leaveFrom").value;
  const to = document.getElementById("leaveTo").value || from;
  const reason = document.getElementById("leaveReason").value;
  if (!from || !reason) {
    showToast("Please fill in date and reason.", "danger", "🚨");
    return;
  }
  
  const staff = STAFF_DATA[currentStaff];
  if (!staff) return;

  const newLeave = { type: leaveType, from, to, reason, status: "pending" };
  
  if (staffLeaves) {
    staffLeaves.unshift(newLeave);
    saveStaffLeaves();
  } else {
    staff.leaves.unshift(newLeave);
    staffLeaves = staff.leaves;
    saveStaffLeaves();
  }
  
  buildLeave(staff);
  
  if (typeof renderFullCalendar === 'function') renderFullCalendar();
  toggleLeaveForm();
  
  document.getElementById("leaveFrom").value = "";
  document.getElementById("leaveTo").value = "";
  document.getElementById("leaveReason").value = "";
  showToast("Leave request submitted.", "success", "📋");
}`;

appJs = appJs.replace(/function submitLeave\(\) \{[\s\S]*?showToast\("Leave request submitted\.", "success", "📋"\);\n\}/, newSubmitLeave);

fs.writeFileSync('app.js', appJs);
console.log('Fixed submitLeave logic');
