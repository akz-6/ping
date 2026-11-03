// Valida contraste WCAG AA das 6 combinações paleta x tema a partir de src/styles/tokens.css.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

const blocks = {};
const re = /html\[data-theme="(light|dark)"\]\[data-palette="(\w+)"\]\s*\{([^}]*)\}/g;
let m;
while ((m = re.exec(css))) {
  const vars = {};
  for (const v of m[3].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) vars[v[1]] = v[2];
  blocks[`${m[2]}/${m[1]}`] = vars;
}

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// [fg, bg, mínimo, descrição]
const pairs = [
  ["text-1", "bg", 4.5, "texto principal / fundo"],
  ["text-1", "card", 4.5, "texto principal / card"],
  ["text-2", "card", 4.5, "texto secundário / card"],
  ["text-2", "bg", 4.5, "texto secundário / fundo"],
  ["text-3", "card", 4.5, "texto suave / card"],
  ["text-3", "bg", 4.5, "texto suave / fundo"],
  ["on-primary", "primary", 4.5, "texto do botão primário"],
  ["primary", "bg", 3, "primária / fundo (componente de UI)"],
  ["primary", "card", 3, "primária / card (componente de UI)"],
  ["open-fg", "open-bg", 4.5, "badge Aberta"],
  ["closed-fg", "closed-bg", 4.5, "badge Fechada"],
];

let fail = 0;
for (const [key, v] of Object.entries(blocks)) {
  for (const [fg, bg, min, label] of pairs) {
    const r = ratio(v[fg], v[bg]);
    const ok = r >= min;
    if (!ok) fail++;
    console.log(`${ok ? "OK  " : "FAIL"} ${key.padEnd(16)} ${label.padEnd(40)} ${r.toFixed(2)}:1 (mín ${min})  ${v[fg]} em ${v[bg]}`);
  }
}
console.log(`\n${Object.keys(blocks).length} combinações verificadas, ${fail} falhas.`);
process.exit(fail ? 1 : 0);
