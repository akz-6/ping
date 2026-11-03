export type ThemeChoice = "light" | "dark" | "system";
export type Palette = "indigo" | "teal" | "terracota";

export const PALETTES: { id: Palette; label: string; swatch: string }[] = [
  { id: "indigo", label: "Indigo", swatch: "#4f46e5" },
  { id: "teal", label: "Teal", swatch: "#0f766e" },
  { id: "terracota", label: "Terracota", swatch: "#c2410c" },
];

const THEME_KEY = "ping:theme";
const PALETTE_KEY = "ping:palette";

const media = (): MediaQueryList | null =>
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Armazenamento indisponível: a escolha vale só na sessão.
  }
}

export function getThemeChoice(): ThemeChoice {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function getPalette(): Palette {
  const v = read(PALETTE_KEY);
  return v === "teal" || v === "terracota" ? v : "indigo";
}

function resolved(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return media()?.matches ? "dark" : "light";
  return choice;
}

function apply(choice: ThemeChoice, palette: Palette): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved(choice));
  root.setAttribute("data-palette", palette);
}

export function setThemeChoice(choice: ThemeChoice): void {
  write(THEME_KEY, choice === "system" ? null : choice);
  apply(choice, getPalette());
}

export function setPalette(palette: Palette): void {
  write(PALETTE_KEY, palette);
  apply(getThemeChoice(), palette);
}

/** Reaplica ao carregar e acompanha a preferência do sistema enquanto o usuário não escolheu. */
export function initTheme(): void {
  apply(getThemeChoice(), getPalette());
  media()?.addEventListener?.("change", () => {
    if (getThemeChoice() === "system") apply("system", getPalette());
  });
}
