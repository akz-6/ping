import { Banner } from "./components";
import { append, discordIcon, h } from "./dom";
import {
  getProfile,
  linkDiscordAccount,
  resetIdentity,
  saveProfile,
  unlinkDiscordAccount,
  type UserProfile,
} from "./identity";
import { Avatar, Button, Field, openDialog, setLoading } from "./primitives";
import {
  MAX_OPEN_ROOMS,
  MAX_PASSWORD_ATTEMPTS,
  RoomLimitError,
  type Room,
  type PasswordResult,
} from "./services/rooms";
import {
  PALETTES,
  getPalette,
  getThemeChoice,
  setPalette,
  setThemeChoice,
  type Palette,
  type ThemeChoice,
} from "../theme";
import { toast } from "../ui";
import { getConsentStatus, resetConsent, openConsentBanner } from "./services/ads";
import { isPwaInstallable, promptPwaInstall } from "./services/pwa";

/* ---------- ModalCriarSala ---------- */
export function openCreateRoomModal(opts: {
  openCount: () => number;
  isOwner?: boolean;
  onCreate: (name: string, password: string) => Promise<void>;
}): void {
  const name = Field({ label: "Nome da sala *", placeholder: "Ex.: Café da manhã", maxLength: 40 });
  const pass = Field({
    label: "Senha (opcional)",
    type: "password",
    placeholder: "Deixe em branco para sala aberta",
    hint: "Se colocar senha, a sala se torna privada/fechada.",
    maxLength: 64,
    autocomplete: "new-password",
  });
  const apiError = h("div", { class: "form-error", role: "alert", hidden: true });
  const limitBanner = Banner(
    "warn",
    `Limite de ${MAX_OPEN_ROOMS} salas abertas atingido. Use uma senha para criar uma sala fechada.`,
  );
  const cancel = Button("Cancelar", { variant: "secondary" });
  const submit = Button("Criar Sala", { type: "submit" });

  const form = h(
    "form",
    { class: "dialog-form", novalidate: true },
    apiError,
    name.el,
    pass.el,
    limitBanner,
    h("div", { class: "dialog-actions" }, cancel, submit),
  );

  const dlg = openDialog({
    title: "Criar sala",
    subtitle: "Crie uma sala para transmissão de tela (máximo 2 pessoas).",
    body: [form],
    onClose: () => {
      pass.input.value = "";
    },
  });

  const refresh = (): void => {
    const limited = opts.openCount() >= MAX_OPEN_ROOMS;
    const hasPassword = pass.input.value.length > 0;
    limitBanner.hidden = !limited;
    submit.disabled = limited && !hasPassword;
  };
  pass.input.addEventListener("input", refresh);
  refresh();
  name.input.focus();

  cancel.addEventListener("click", () => dlg.close());
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    const value = name.input.value.trim();
    if (!value) {
      name.setError("Informe o nome da sala.");
      name.input.focus();
      return;
    }
    name.setError(null);
    apiError.hidden = true;
    setLoading(submit, true);
    dlg.setBusy(true);
    try {
      await opts.onCreate(value, pass.input.value);
      dlg.setBusy(false);
      dlg.close();
    } catch (err) {
      dlg.setBusy(false);
      setLoading(submit, false);
      apiError.hidden = false;
      apiError.textContent =
        err instanceof RoomLimitError
          ? `Limite de ${MAX_OPEN_ROOMS} salas abertas atingido. Use uma senha para criar uma sala fechada.`
          : "Não foi possível criar a sala. Tente novamente.";
      refresh();
    }
  });
}

/* ---------- ModalSenhaSala ---------- */
export function openPasswordModal(opts: {
  room: Room;
  verify: (password: string) => Promise<PasswordResult>;
  onSuccess: (room: Room) => void;
}): void {
  const pass = Field({
    label: "Senha",
    type: "password",
    placeholder: "Digite a senha da sala",
    maxLength: 64,
    autocomplete: "off",
  });
  const attempts = h("p", { class: "attempts", role: "status" }, `Tentativas: 0 / ${MAX_PASSWORD_ATTEMPTS}`);
  const cancel = Button("Cancelar", { variant: "secondary" });
  const submit = Button("Entrar", { type: "submit" });

  const form = h(
    "form",
    { class: "dialog-form", novalidate: true },
    pass.el,
    attempts,
    h("div", { class: "dialog-actions" }, cancel, submit),
  );

  const dlg = openDialog({
    title: "Sala fechada",
    subtitle: `${opts.room.name} — Sala de ${opts.room.host}`,
    body: [form],
    onClose: () => {
      pass.input.value = "";
    },
  });

  let used = 0;
  let lockTimer: number | undefined;

  const lock = (ms: number): void => {
    pass.setDisabled(true);
    submit.disabled = true;
    const until = Date.now() + ms;
    const tick = (): void => {
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left <= 0) {
        used = 0;
        pass.setDisabled(false);
        submit.disabled = false;
        pass.setError(null);
        attempts.textContent = `Tentativas: 0 / ${MAX_PASSWORD_ATTEMPTS}`;
        attempts.classList.remove("is-last");
        pass.input.focus();
        return;
      }
      pass.setError(`Muitas tentativas. Tente de novo em ${left}s.`);
      lockTimer = window.setTimeout(tick, 1000);
    };
    tick();
  };

  cancel.addEventListener("click", () => dlg.close());
  dlg.el.addEventListener("close", () => window.clearTimeout(lockTimer));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    if (!pass.input.value) {
      pass.setError("Digite a senha.");
      return;
    }
    pass.setError(null);
    setLoading(submit, true);
    dlg.setBusy(true);
    try {
      const res = await opts.verify(pass.input.value);
      dlg.setBusy(false);
      setLoading(submit, false);
      if (res.ok) {
        dlg.close();
        opts.onSuccess(opts.room);
        return;
      }
      used = MAX_PASSWORD_ATTEMPTS - res.attemptsLeft;
      attempts.textContent = `Tentativas: ${used} / ${MAX_PASSWORD_ATTEMPTS}`;
      attempts.classList.toggle("is-last", res.attemptsLeft <= 1);
      pass.input.value = "";
      if (res.lockedMs) {
        lock(res.lockedMs);
      } else {
        pass.setError("Senha incorreta.");
        form.classList.remove("shake");
        void form.offsetWidth;
        form.classList.add("shake");
        pass.input.focus();
      }
    } catch {
      dlg.setBusy(false);
      setLoading(submit, false);
      pass.setError("Não foi possível verificar a senha. Tente novamente.");
    }
  });
}

/* ---------- ModalPerfil ---------- */
function radioGroup<T extends string>(
  legend: string,
  name: string,
  options: { value: T; label: string; swatch?: string }[],
  current: T,
  onChange: (v: T) => void,
): HTMLElement {
  return h(
    "fieldset",
    { class: "segmented" },
    h("legend", { class: "field-label" }, legend),
    h(
      "div",
      { class: "segmented-row" },
      ...options.map((o) => {
        const input = h("input", { type: "radio", name, value: o.value, class: "segmented-input" });
        input.checked = o.value === current;
        input.addEventListener("change", () => onChange(o.value));
        return h(
          "label",
          { class: "segmented-opt" },
          input,
          h(
            "span",
            { class: "segmented-face" },
            o.swatch ? h("span", { class: `swatch swatch-${o.swatch}`, "aria-hidden": "true" }) : null,
            o.label,
          ),
        );
      }),
    ),
  );
}

/* ---------- ModalConectarDiscord ---------- */
export function openDiscordConnectModal(opts: {
  onConnected?: (p: UserProfile) => void;
}): void {
  const usernameField = Field({
    label: "Seu usuário no Discord",
    placeholder: "Ex: usuario ou usuario#0000",
    maxLength: 32,
  });
  usernameField.input.id = "discord-username-input";

  const infoText = h(
    "p",
    { class: "field-hint" },
    "Vincule sua conta do Discord para identificação nas salas de transmissão. Você poderá desvincular a qualquer momento.",
  );

  const cancelBtn = Button("Cancelar", { variant: "secondary" });
  const confirmBtn = Button("Autorizar e Vincular", {
    variant: "discord",
    type: "submit",
    id: "discord-connect-confirm",
  });

  const actions = h("div", { class: "dialog-actions" }, cancelBtn, confirmBtn);
  const form = h("form", { class: "dialog-form" }, usernameField.el, infoText, actions);

  const dlg = openDialog({
    title: "Conectar com Discord",
    subtitle: "Exiba sua identidade do Discord na plataforma Ping.",
    body: [form],
  });

  cancelBtn.addEventListener("click", () => dlg.close());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = usernameField.input.value.trim();
    if (!val) {
      usernameField.setError("Digite seu nome de usuário do Discord.");
      usernameField.input.focus();
      return;
    }
    usernameField.setError(null);
    setLoading(confirmBtn, true);
    dlg.setBusy(true);

    try {
      const updated = linkDiscordAccount(val);
      dlg.setBusy(false);
      setLoading(confirmBtn, false);
      dlg.close();
      toast(`Conta do Discord (@${updated.discordUsername}) vinculada com sucesso!`);
      opts.onConnected?.(updated);
    } catch {
      dlg.setBusy(false);
      setLoading(confirmBtn, false);
      usernameField.setError("Não foi possível vincular. Tente novamente.");
    }
  });

  window.setTimeout(() => usernameField.input.focus(), 50);
}

export function openProfileModal(opts: { handle: string; onSaved?: (p: UserProfile) => void }): void {
  let profile = getProfile();

  const nick = Field({
    label: "Apelido de exibição",
    placeholder: "Ex: Seu Apelido ou Nome Social",
    maxLength: 32,
  });
  nick.input.value = profile.displayName !== profile.handle ? profile.displayName : "";

  const full = Field({
    label: "Nome completo",
    placeholder: "Ex: Carlos Eduardo da Silva",
    maxLength: 80,
  });
  full.input.value = profile.fullName;

  const close = Button("Fechar", { variant: "secondary" });
  const save = Button("Salvar", { variant: "primary" });
  const resetBtn = Button("Redefinir dados", { variant: "secondary" });

  const avatarWrap = h("div", { class: "profile-avatar-wrap" }, Avatar(profile.displayName, 72));
  const handleLabel = h("p", { class: "profile-handle" }, profile.displayName);
  const badgeLabel = h("span", { class: "profile-badge" }, "");

  const updateHeader = (): void => {
    const val = nick.input.value.trim();
    const typed = val || profile.displayName || profile.handle;
    handleLabel.textContent = typed;
    avatarWrap.replaceChildren(Avatar(typed, 72));
    badgeLabel.textContent = profile.discordLinked
      ? `Discord: @${profile.discordUsername || "conectado"}`
      : !val || val === profile.handle
      ? "Anônimo"
      : "Personalizado";
  };
  updateHeader();

  const header = h(
    "div",
    { class: "profile-head" },
    avatarWrap,
    h(
      "div",
      { class: "profile-head-text" },
      handleLabel,
      badgeLabel,
    ),
  );

  nick.input.addEventListener("input", () => {
    updateHeader();
  });

  const discordSlot = h("div", { class: "profile-discord-slot" });

  const renderDiscordSlot = (): void => {
    discordSlot.replaceChildren();
    if (profile.discordLinked) {
      const unlinkBtn = Button("Desconectar", {
        variant: "secondary",
        id: "btn-unlink-discord",
        onClick: () => {
          profile = unlinkDiscordAccount();
          updateHeader();
          renderDiscordSlot();
          opts.onSaved?.(profile);
          toast("Conta do Discord desconectada.");
        },
      });

      const box = h(
        "div",
        { class: "discord-linked-box" },
        h(
          "div",
          { class: "discord-linked-info" },
          discordIcon(24),
          h(
            "div",
            { class: "discord-linked-text" },
            h("span", { class: "discord-linked-tag" }, `@${profile.discordUsername || "Discord"}`),
            h("span", { class: "discord-badge-pill" }, "Conectado"),
          ),
        ),
        unlinkBtn,
      );
      discordSlot.append(box);
    } else {
      const connectBtn = Button("Conectar com Discord (Opcional)", {
        variant: "discord",
        block: true,
        id: "btn-connect-discord",
        onClick: () => {
          openDiscordConnectModal({
            onConnected: (updated) => {
              profile = updated;
              if (nick.input.value === "" || nick.input.value === profile.handle) {
                nick.input.value = profile.displayName;
              }
              updateHeader();
              renderDiscordSlot();
              opts.onSaved?.(profile);
            },
          });
        },
      });
      discordSlot.append(connectBtn);
    }
  };
  renderDiscordSlot();

  const note = h(
    "p",
    { class: "field-hint" },
    "Nome e apelido são salvos localmente no seu dispositivo. O login com Discord é opcional.",
  );

  const appearance = radioGroup<ThemeChoice>(
    "Aparência",
    "theme",
    [
      { value: "light", label: "Claro" },
      { value: "dark", label: "Escuro" },
      { value: "system", label: "Sistema" },
    ],
    getThemeChoice(),
    setThemeChoice,
  );
  const palette = radioGroup<Palette>(
    "Paleta",
    "palette",
    PALETTES.map((p) => ({ value: p.id, label: p.label, swatch: p.id })),
    getPalette(),
    setPalette,
  );

  const privacyBox = h("div", { class: "profile-privacy-box" });
  const consentSt = getConsentStatus();
  privacyBox.append(
    h("span", { class: "field-label" }, "Privacidade & Anúncios"),
    h(
      "div",
      { class: "profile-privacy-row" },
      h(
        "span",
        { class: "profile-privacy-text" },
        consentSt === "accepted" ? "Anúncios permitidos (apoia a plataforma)" : "Apenas itens essenciais",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-secondary btn-sm",
          onClick: () => {
            dlg.close();
            resetConsent();
            openConsentBanner();
          },
        },
        "Gerenciar preferências",
      ),
    ),
  );

  const pwaBtn = Button("Instalar aplicativo (PWA)", { variant: "secondary", block: true });
  pwaBtn.hidden = !isPwaInstallable();
  const onInstallable = () => {
    pwaBtn.hidden = false;
  };
  window.addEventListener("ping:pwa-installable", onInstallable);
  pwaBtn.addEventListener("click", async () => {
    const installed = await promptPwaInstall();
    if (installed) {
      toast("Instalação do Ping concluída!");
      pwaBtn.hidden = true;
    }
  });

  const body = h("div", { class: "dialog-form" });
  append(body, [
    header,
    nick.el,
    full.el,
    discordSlot,
    note,
    appearance,
    palette,
    privacyBox,
    pwaBtn,
    h("div", { class: "dialog-actions" }, resetBtn, close, save),
  ]);

  const dlg = openDialog({ title: "Seu perfil", body: [body] });

  close.addEventListener("click", () => dlg.close());
  dlg.el.addEventListener("close", () => window.removeEventListener("ping:pwa-installable", onInstallable));

  save.addEventListener("click", () => {
    const updated = saveProfile({
      displayName: nick.input.value,
      fullName: full.input.value,
    });
    opts.onSaved?.(updated);
    toast("Perfil atualizado com sucesso!");
    dlg.close();
  });

  resetBtn.addEventListener("click", () => {
    profile = resetIdentity();
    nick.input.value = "";
    full.input.value = "";
    updateHeader();
    renderDiscordSlot();
    opts.onSaved?.(profile);
    toast("Identidade local redefinida.");
  });
}
