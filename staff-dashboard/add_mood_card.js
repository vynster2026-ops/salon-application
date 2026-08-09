const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');

const addition = `

            <!-- CLIENT MOOD SECTION -->
            <div class="card" style="margin-top: 20px;">
              <div class="card-head">
                <div class="card-title">Client Mood</div>
              </div>
              <div class="card-body p-0" id="clientMoodList">
                <!-- Populated dynamically by app.js -->
              </div>
            </div>`;

if (!content.includes('id="clientMoodList"')) {
    content = content.replace(/(<div class="card-title">Salon Updates<\/div>[\s\S]*?<div class="ann-desc">New L'Oréal professional kits arrived.<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/div>)/, '$1' + addition);
    fs.writeFileSync('index.html', content);
    console.log("Success");
} else {
    console.log("Already added");
}
