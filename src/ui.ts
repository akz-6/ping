export function $<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Elemento não encontrado: ${selector}`);
  return el;
}

export function toast(message: string, kind: "info" | "error" = "info"): void {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 4500);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Alfabeto de 32 caracteres sem ambiguidade visual (24 letras + 8 dígitos = 5 bits exatos por char, sem viés de módulo)
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

/** Gera ID aleatório criptográfico. Padrão: 12 caracteres (60 bits de entropia). */
export function shortId(length = 12): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}
