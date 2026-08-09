const fs = require('fs');

let content = fs.readFileSync('staff-summary.html', 'utf8');

// I will insert </script></div><style> at the very end of the renderLeaderboard function.
// Since the file has been mangled, let's look for "tbody.appendChild(tr); \n    }); \n  }"
let idx = content.indexOf('tbody.appendChild(tr);\n    });\n  }');
if (idx !== -1) {
  let before = content.substring(0, idx + 'tbody.appendChild(tr);\n    });\n  }'.length);
  
  // Find the next .settings-section
  let idxAfter = content.indexOf('.settings-section {', idx);
  let after = content.substring(idxAfter);

  let newMiddle = `
</script>
</div>
<style>
  .leaderboard-table th {
    padding: 16px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--muted);
    border-bottom: 2px solid var(--border);
  }
  .leaderboard-table td {
    padding: 16px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
    transition: background-color 0.2s;
  }
  .leaderboard-table tr:hover td {
    background-color: var(--muted-bg);
  }
  .leaderboard-table tr:last-child td {
    border-bottom: none;
  }

  .readonly-style {
    background: transparent !important;
    border-color: transparent !important;
    padding-left: 0 !important;
    font-weight: 600;
    color: var(--primary) !important;
    cursor: default;
  }

  .readonly-style::placeholder {
    color: transparent;
  }

  #setAadhar.readonly-style::placeholder,
  #setPan.readonly-style::placeholder,
  #setBankAcc.readonly-style::placeholder,
  #setBankIfsc.readonly-style::placeholder {
    color: var(--muted) !important;
    font-weight: normal;
    font-style: italic;
  }

    `;

  fs.writeFileSync('staff-summary.html', before + newMiddle + after);
  console.log('Fixed staff-summary.html structure!');
} else {
  console.log('Could not find the target string!');
}
