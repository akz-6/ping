export type ThemeChoice = "dark" | "light" | "system";

const THEME_KEY = "ping:theme";

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
    // Armazenamento indisponível
  }
}

export function getThemeChoice(): ThemeChoice {
  const v = read(THEME_KEY);
  return v === "light" || v === "dark" ? v : "dark"; // dark é o padrão
}

function resolved(choice: ThemeChoice): "light" | "dark" {
  if (choice === "system") return media()?.matches ? "dark" : "light";
  return choice;
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  const res = resolved(choice);
  root.dataset.theme = res;
  root.setAttribute("data-theme", res);
  root.removeAttribute("data-palette");
}

export function setThemeChoice(choice: ThemeChoice): void {
  write(THEME_KEY, choice === "system" ? null : choice);
  applyTheme(choice);
}

/** Reaplica ao carregar e acompanha a preferência do sistema enquanto o usuário não escolheu. */
export function initTheme(): void {
  applyTheme(getThemeChoice());
  media()?.addEventListener?.("change", () => {
    if (getThemeChoice() === "system") applyTheme("system");
  });
}
