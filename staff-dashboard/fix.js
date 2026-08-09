const fs = require('fs');

// 1. Get clean attendance content
let att = fs.readFileSync('attendance.html', 'utf8');
let idxStart = att.indexOf('<!-- ATTENDANCE SUMMARY -->');
let idxEnd = att.indexOf('<!-- PAYSLIP -->');
let attContent = att.substring(idxStart, idxEnd);
let idxGridEnd = attContent.lastIndexOf('</div>\r\n      </div>');
if (idxGridEnd === -1) idxGridEnd = attContent.lastIndexOf('</div>\n      </div>');
if (idxGridEnd !== -1) {
    attContent = attContent.substring(0, idxGridEnd + 6);
}

// Fix margin
attContent = attContent.replace('class="att-summary-grid"', 'class="att-summary-grid" style="margin-top: 20px;"');

let idxHtml = fs.readFileSync('index.html', 'utf8');

// 2. Remove the broken attendance section completely from index.html
let brokenStart = idxHtml.indexOf('<!-- ATTENDANCE SECTION -->');
let mainEnd = idxHtml.indexOf('</main>');

let cleanIdx = idxHtml.substring(0, brokenStart) + '\n\n      <!-- ATTENDANCE SECTION -->\n      <div id="attendanceSection" class="content-section hidden">\n        ' + attContent + '\n      </div>\n    ' + idxHtml.substring(mainEnd);

// Also remove the extra div tags I accidentally injected
// The bad inject created:
/*
      </div>
            </div>

          </div>
        </div>
      </div>

      </div>

      <!-- ATTENDANCE SECTION -->
*/
// Let's replace the broken structure:
cleanIdx = cleanIdx.replace('      </div>\r\n            </div>\r\n\r\n          </div>\r\n        </div>\r\n      </div>\r\n\r\n      </div>\r\n\r\n      <!-- ATTENDANCE SECTION -->', '      </div>\r\n\r\n      <!-- ATTENDANCE SECTION -->');

fs.writeFileSync('index.html', cleanIdx);
console.log("Restored properly!");
