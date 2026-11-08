import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');

if (!fs.existsSync(distDir)) {
  console.error('[audit] dist/ directory not found! Run npm run build first.');
  process.exit(1);
}

let errors = 0;

// 1. Audit HTML files for inline style attribute
function checkHtmlFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkHtmlFiles(fullPath);
    } else if (entry.name.endsWith('.html')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('style=')) {
        console.error(`[audit] ERROR: Inline style=" found in ${fullPath}`);
        errors++;
      } else {
        console.log(`[audit] PASS: No inline style in ${entry.name}`);
      }
    }
  }
}

checkHtmlFiles(distDir);

// 2. Audit JS files for leaked secret keys or env variable names
const forbiddenPatterns = [
  'CF_CALLS_APP_SECRET',
  'DISCORD_CLIENT_SECRET',
  'SESSION_SECRET',
  'METERED_API_KEY',
  'OWNER_KEY'
];

const jsDir = path.join(distDir, 'assets');
if (fs.existsSync(jsDir)) {
  const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js') && !f.endsWith('.map'));
  for (const file of jsFiles) {
    const content = fs.readFileSync(path.join(jsDir, file), 'utf8');
    for (const pattern of forbiddenPatterns) {
      if (content.includes(pattern)) {
        console.error(`[audit] ERROR: Forbidden secret token "${pattern}" found in ${file}`);
        errors++;
      }
    }
    // Also verify "0604" isn't hardcoded as owner key in client bundle
    if (content.includes('"0604"') || content.includes("'0604'")) {
      console.error(`[audit] ERROR: Master key "0604" found hardcoded in ${file}`);
      errors++;
    }
  }
}

if (errors === 0) {
  console.log('[audit] ALL CHECKS PASSED: Zero leaked secrets, zero inline styles in dist.');
  process.exit(0);
} else {
  console.error(`[audit] FAILED: ${errors} errors detected in dist/`);
  process.exit(1);
}
