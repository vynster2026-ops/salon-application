const fs = require('fs');
let html = fs.readFileSync('analytics.html', 'utf8');

// The file has a duplicate <div class="main-wrap"> block.
// The first one ends with a stray </aside> and then starts another main-wrap.
// Let's find the first </aside> which closes the sidebar (around line 64)
const firstAsideEnd = html.indexOf('</aside>');

// Then there's another stray </aside> later in the file.
const secondAsideEnd = html.indexOf('</aside>', firstAsideEnd + 8);

if (secondAsideEnd !== -1) {
    // We want to delete everything from just after the first </aside> up to and including the second </aside>.
    const toDeleteStart = firstAsideEnd + 8; // After first </aside>
    const toDeleteEnd = secondAsideEnd + 8; // After second </aside>
    
    html = html.substring(0, toDeleteStart) + '\n' + html.substring(toDeleteEnd);
    fs.writeFileSync('analytics.html', html);
    console.log('Fixed analytics.html successfully!');
} else {
    console.log('Second </aside> not found, maybe already fixed?');
}
