const fs = require('fs');
const path = 'C:\\Users\\S Pavani\\.gemini\\antigravity-ide\\brain\\113790f0-c75f-47a1-8ed8-d018b0862bf7\\.system_generated\\logs\\transcript.jsonl';
const lines = fs.readFileSync(path, 'utf-8').split('\n');
for (const line of lines) {
    if (!line) continue;
    try {
        const step = JSON.parse(line);
        const str = JSON.stringify(step);
        if (str.includes('schedule.html') && str.includes('Total Lines: 544')) {
            let output = "";
            if (step.content && step.content.includes('Total Lines: 544')) output = step.content;
            else if (step.tool_responses) {
                const res = step.tool_responses[0];
                if (res.tool_response && res.tool_response.output) output = res.tool_response.output;
                else if (res.response && res.response.output) output = res.response.output;
            } else if (step.tool_calls) {
                // sometimes the structure is under tool_calls -> response
                const calls = step.tool_calls;
                for (const c of calls) {
                    if (c.response && c.response.output && c.response.output.includes('Total Lines: 544')) {
                        output = c.response.output;
                    }
                }
            }
            if (!output) continue;
            
            const outLines = output.split('\n');
            const clean = [];
            let isCode = false;
            for (const l of outLines) {
                if (l.includes('The following code has been modified')) { isCode = true; continue; }
                if (l.includes('The above content shows the entire')) { break; }
                if (isCode) {
                    const idx = l.indexOf(': ');
                    if (idx !== -1 && !isNaN(parseInt(l.substring(0, idx)))) {
                        clean.push(l.substring(idx + 2).replace(/\r$/, ''));
                    } else {
                        clean.push(l.replace(/\r$/, ''));
                    }
                }
            }
            if (clean.length > 0) {
                fs.writeFileSync('schedule.html', clean.join('\n'));
                console.log('Restored!');
                process.exit(0);
            }
        }
    } catch(e) {}
}
console.log('Not found');
