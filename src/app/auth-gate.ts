import { openDialog } from "./primitives";
import { Button, Field } from "./primitives";
import { h } from "./dom";

const STORAGE_KEY = "ping:creator_authorized";

async function verifyCreatorKeyOnServer(candidate: string): Promise<boolean> {
  const clean = candidate.trim();
  if (!clean) return false;
  try {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify-creator-key", key: clean }),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean };
      return Boolean(data?.ok);
    }
  } catch {
    // falha na rede
  }
  return false;
}

let checkUrlPromise: Promise<boolean> | null = null;

export function checkUrlForCreatorKey(): Promise<boolean> {
  if (checkUrlPromise) return checkUrlPromise;
  try {
    const params = new URLSearchParams(location.search);
    const candidate = params.get("admin") || params.get("creator_key") || params.get("key");

    if (candidate) {
      params.delete("admin");
      params.delete("creator_key");
      params.delete("key");
      const query = params.toString();
      const cleanUrl = location.pathname + (query ? `?${query}` : "");
      history.replaceState(null, "", cleanUrl);

      checkUrlPromise = authorizeCreator(candidate);
      return checkUrlPromise;
    }
  } catch {
    // ignora
  }
  return Promise.resolve(false);
}

// Executa imediatamente na inicialização
void checkUrlForCreatorKey();

export function isCreatorAuthorized(): boolean {
  try {
    // 1. Verifica se a máquina já foi autorizada no localStorage deste navegador
    if (localStorage.getItem(STORAGE_KEY) === "true") {
      return true;
    }

    // 2. Em localhost (testes automatizados e desenvolvimento local), a máquina é autorizada
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

export async function authorizeCreator(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const ok = await verifyCreatorKeyOnServer(candidate);
  if (ok) {
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
    placeholder: "Digite a chave do anfitrião",
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

  confirmUnlockBtn.addEventListener("click", async () => {
    const val = unlockInput.input.value;
    confirmUnlockBtn.disabled = true;
    const ok = await authorizeCreator(val);
    confirmUnlockBtn.disabled = false;
    if (ok) {
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
