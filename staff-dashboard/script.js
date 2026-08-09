
const fs = require("fs");
const dir = ".";
const files = fs.readdirSync(dir).filter(f => f.endsWith(".html"));

files.forEach(file => {
  let content = fs.readFileSync(file, "utf8");
  
  // replace anything that looks like Logout ?? inside a span
  content = content.replace(/·?\s*<span[^>]*>Logout ??<\/span>/gi, "");
  
  // special case for multiline in clients.html
  content = content.replace(/·?\s*<span[\s\S]*?Logout ??<\/span>/gi, "");

  fs.writeFileSync(file, content);
});
console.log("Done");

