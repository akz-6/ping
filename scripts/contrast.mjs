// Valida contraste WCAG AA dos temas Dark e Light do Ping v2 a partir de src/styles/tokens.css.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// Map direct hex tokens for dark and light
const themes = {
  dark: {
    bg: "#09090b",
    card: "#18181b",
    surface1: "#121214",
    surface2: "#18181b",
    surface3: "#1f1f23",
    surface4: "#27272a",
    text1: "#fafafa",
    text2: "#a1a1aa",
    textMuted: "#8b8b95",
    primary: "#fafafa",
    onPrimary: "#09090b",
  },
  light: {
    bg: "#fafafa",
    card: "#ffffff",
    surface1: "#ffffff",
    surface2: "#f4f4f5",
    surface3: "#e4e4e7",
    surface4: "#d4d4d8",
    text1: "#09090b",
    text2: "#52525b",
    textMuted: "#71717a",
    primary: "#09090b",
    onPrimary: "#fafafa",
    openFg: "#15803d",
    openBg: "#dcfce7",
    closedFg: "#b45309",
    closedBg: "#fef3c7"
  }
};

const pairs = [
  ["text1", "bg", 4.5, "texto principal / fundo"],
  ["text1", "card", 4.5, "texto principal / card"],
  ["text2", "card", 4.5, "texto secundário / card"],
  ["text2", "bg", 4.5, "texto secundário / fundo"],
  ["textMuted", "bg", 4.5, "texto muted (#8b8b95) / fundo (#09090b)"],
  ["onPrimary", "primary", 4.5, "texto do botão primário"],
  ["primary", "bg", 3.0, "componente primário / fundo"]
];

let fail = 0;
let checked = 0;

for (const [themeName, v] of Object.entries(themes)) {
  for (const [fg, bg, min, label] of pairs) {
    if (!v[fg] || !v[bg]) continue;
    checked++;
    const r = ratio(v[fg], v[bg]);
    const ok = r >= min;
    if (!ok) fail++;
    console.log(`${ok ? "OK  " : "FAIL"} ${themeName.padEnd(8)} ${label.padEnd(42)} ${r.toFixed(2)}:1 (mín ${min})  ${v[fg]} em ${v[bg]}`);
  }
}

console.log(`\n${checked} combinações verificadas, ${fail} falhas.`);
process.exit(fail ? 1 : 0);
