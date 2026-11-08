const fs = require("fs");
const path = require("path");

const e2eDir = path.join(process.cwd(), "e2e");
const files = fs.readdirSync(e2eDir).filter(f => f.endsWith(".spec.ts"));

const ids = new Set();
const classes = new Set();
const testIds = new Set();

for (const file of files) {
  const content = fs.readFileSync(path.join(e2eDir, file), "utf8");

  // getByTestId('...')
  const testIdMatches = content.matchAll(/getByTestId\(\s*["'`]?([^"'`]+)["'`]?\s*\)/g);
  for (const m of testIdMatches) testIds.add(m[1].trim());

  // data-testid="..."
  const dtMatches = content.matchAll(/data-testid=["']([^"']+)["']/g);
  for (const m of dtMatches) testIds.add(m[1].trim());

  // #id
  const idMatches = content.matchAll(/#([a-zA-Z0-9_\-]+)/g);
  for (const m of idMatches) {
    const id = m[1].trim();
    if (!id.match(/^[0-9a-fA-F]{3,6}$/)) { // exclude hex colors if any
      ids.add(id);
    }
  }

  // .class in locators or querySelectors
  const classLocMatches = content.matchAll(/(?:locator|\$|\$\$|hasText|filter|toHaveClass)\(\s*["'`][^"'`]*?\.([a-zA-Z][a-zA-Z0-9_\-]*)/g);
  for (const m of classLocMatches) {
    classes.add(m[1].trim());
  }
}

if (!fs.existsSync("docs")) fs.mkdirSync("docs");
const baseline = {
  ids: Array.from(ids).sort(),
  classes: Array.from(classes).sort(),
  testIds: Array.from(testIds).sort()
};

fs.writeFileSync("docs/selectors-baseline.json", JSON.stringify(baseline, null, 2));
console.log("Extracted IDs:", baseline.ids.length, "Classes:", baseline.classes.length, "TestIds:", baseline.testIds.length);
