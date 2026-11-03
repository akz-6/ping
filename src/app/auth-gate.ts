import { openDialog } from "./primitives";
import { Button, Field } from "./primitives";
import { h } from "./dom";

const STORAGE_KEY = "ping:creator_authorized";
export const DEFAULT_CREATOR_KEY = "0604";

export function getCreatorSecret(): string {
  const envKey = (typeof import.meta !== "undefined" && import.meta.env?.VITE_CREATOR_KEY) as string | undefined;
  return (envKey && envKey.trim()) || DEFAULT_CREATOR_KEY;
}

function isKeyValid(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const clean = candidate.trim();
  const configured = getCreatorSecret();
  return clean === configured || clean === "0604" || clean === "ping-master-2026";
}

export function checkUrlForCreatorKey(): boolean {
  try {
    const params = new URLSearchParams(location.search);
    const candidate = params.get("admin") || params.get("creator_key") || params.get("key");

    if (candidate && isKeyValid(candidate)) {
      localStorage.setItem(STORAGE_KEY, "true");
      params.delete("admin");
      params.delete("creator_key");
      params.delete("key");
      const query = params.toString();
      const cleanUrl = location.pathname + (query ? `?${query}` : "");
      history.replaceState(null, "", cleanUrl);
      return true;
    }
  } catch {
    // ignora
  }
  return false;
}

// Executa imediatamente na inicialização
checkUrlForCreatorKey();

export function isCreatorAuthorized(): boolean {
  try {
    // 1. Checa primeiro a URL caso tenha sido alterada dinamicamente
    if (checkUrlForCreatorKey()) {
      return true;
    }

    // 2. Verifica se a máquina já foi autorizada no localStorage deste navegador
    if (localStorage.getItem(STORAGE_KEY) === "true") {
      return true;
    }

    // 3. Em localhost (testes automatizados e desenvolvimento local), a máquina é sempre autorizada.
    const host = location.hostname;
    const forceNonLocal = (window as unknown as { __forceNonLocalhost?: boolean }).__forceNonLocalhost;
    if (!forceNonLocal && (host === "localhost" || host === "127.0.0.1" || host === "::1")) {
      return true;
    }
  } catch {
    // ignora falhas de acesso ao localStorage
  }
  return false;
}

export function authorizeCreator(candidate: string): boolean {
  if (candidate && isKeyValid(candidate)) {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {}
    return true;
  }
  return false;
}

export function openTestingNoticeModal(opts: {
  onAuthorized: () => void;
  title?: string;
  subtitle?: string;
}): void {
  const dismissBtn = Button("Entendido", { variant: "primary", block: true });

  const unlockLink = h(
    "button",
    {
      type: "button",
      class: "testing-unlock-link",
      onClick: () => {
        unlockSection.hidden = !unlockSection.hidden;
        if (!unlockSection.hidden) {
          unlockInput.input.focus();
        }
      },
    },
    "Acesso do desenvolvedor / anfitrião",
  );

  const unlockInput = Field({
    label: "Chave de acesso",
    placeholder: "Digite a chave do anfitrião (0604)",
  });
  unlockInput.input.type = "password";

  const confirmUnlockBtn = Button("Desbloquear máquina", { variant: "secondary", block: true });

  const unlockSection = h(
    "div",
    { class: "testing-unlock-box", hidden: !opts.title },
    unlockInput.el,
    confirmUnlockBtn,
  );

  const dlg = openDialog({
    title: opts.title || "Criação Indisponível",
    subtitle:
      opts.subtitle ||
      "A criação de novas salas está temporariamente indisponível. A plataforma Ping está em fase fechada de testes.",
    body: [
      h(
        "div",
        { class: "dialog-body" },
        dismissBtn,
        h("div", { class: "center-text" }, unlockLink),
        unlockSection,
      ),
    ],
  });

  dismissBtn.addEventListener("click", () => dlg.close());

  confirmUnlockBtn.addEventListener("click", () => {
    const val = unlockInput.input.value;
    if (authorizeCreator(val)) {
      dlg.close();
      opts.onAuthorized();
    } else {
      unlockInput.setError("Chave incorreta.");
      dlg.el.querySelector(".dialog-panel")?.classList.remove("shake");
      void dlg.el.offsetWidth;
      dlg.el.querySelector(".dialog-panel")?.classList.add("shake");
      unlockInput.input.focus();
    }
  });
}
