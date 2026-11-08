const fs = require('fs');
const path = require('path');

function scanDir(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        scanDir(fullPath, found);
      }
    } else if (entry.name.endsWith('.css') || entry.name.endsWith('.ts')) {
      if (entry.name === 'tokens.css') continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, lineNo) => {
        // Strip selectors like #app, #v, #toasts, #setup
        // Also strip comments
        const clean = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/g, '');
        const matches = clean.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
        if (matches) {
          // Check if match is part of an ID selector like `#app {` or `locator('#toasts')`
          matches.forEach(m => {
            const idx = clean.indexOf(m);
            const before = clean.slice(Math.max(0, idx - 15), idx);
            // If preceded by locator( or getElementById( or is a css selector #foo
            if (/locator\s*\(\s*["']$/.test(before) || /getElementById\s*\(\s*["']$/.test(before)) {
              return;
            }
            found.push({ file: fullPath, line: lineNo + 1, match: m, text: line.trim() });
          });
        }
      });
    }
  }
  return found;
}

const found = scanDir('src').concat(scanDir('public'));
console.log('Hex colors found outside tokens.css:', found.length);
found.slice(0, 15).forEach(f => console.log(`${f.file}:${f.line}: ${f.match} -> ${f.text}`));
if (found.length > 0) process.exit(1);
