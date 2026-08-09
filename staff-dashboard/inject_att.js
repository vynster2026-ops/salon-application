const fs = require('fs');
let att = fs.readFileSync('attendance.html', 'utf8');
let idxStart = att.indexOf('<!-- ATTENDANCE SUMMARY -->');
let idxEnd = att.indexOf('<!-- PAYSLIP -->');
let attContent = att.substring(idxStart, idxEnd);
let idxGridEnd = attContent.lastIndexOf('</div>\r\n      </div>');
if (idxGridEnd === -1) idxGridEnd = attContent.lastIndexOf('</div>\n      </div>');
if (idxGridEnd !== -1) {
    attContent = attContent.substring(0, idxGridEnd + 6);
}

let idxHtml = fs.readFileSync('index.html', 'utf8');
let insertStr = '\n\n      <!-- ATTENDANCE SECTION -->\n      <div id="attendanceSection" class="content-section hidden">\n        ' + attContent + '\n      </div>\n';

let newIdxHtml = idxHtml.replace('      </div>\r\n    </main>', '      </div>' + insertStr + '    </main>');
if (newIdxHtml === idxHtml) {
    newIdxHtml = idxHtml.replace('      </div>\n    </main>', '      </div>' + insertStr + '    </main>');
}

// Update the navigation in index.html for attendance
newIdxHtml = newIdxHtml.replace(
    /<button class="nav-item ripple" onclick="window\.location\.href='attendance\.html'">([\s\S]*?)<\/button>/,
    '<button class="nav-item ripple" onclick="setSection(\'attendance\', this)">$1</button>'
);

// Update the navigation in index.html for dashboard
newIdxHtml = newIdxHtml.replace(
    /<button class="nav-item ripple active" onclick="window\.location\.href='index\.html'">([\s\S]*?)<\/button>/,
    '<button class="nav-item ripple active" onclick="setSection(\'dashboard\', this)">$1</button>'
);

fs.writeFileSync('index.html', newIdxHtml);
console.log('Successfully injected attendanceSection into index.html');
