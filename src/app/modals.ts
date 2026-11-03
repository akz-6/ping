import { Banner } from "./components";
import { append, h } from "./dom";
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

/* ---------- ModalCriarSala ---------- */
export function openCreateRoomModal(opts: {
  openCount: () => number;
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
    subtitle: "Crie um espaço para conversar com outras pessoas.",
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

export function openProfileModal(opts: { handle: string }): void {
  const connect = Button("Conectar com Discord", { variant: "discord", block: true });
  const nick = Field({ label: "Apelido de exibição", placeholder: "Disponível após conectar", maxLength: 32 });
  const full = Field({ label: "Nome completo", placeholder: "Disponível após conectar", maxLength: 80 });
  nick.setDisabled(true);
  full.setDisabled(true);

  const close = Button("Fechar", { variant: "secondary" });
  const save = Button("Salvar");
  save.disabled = true;

  const header = h(
    "div",
    { class: "profile-head" },
    Avatar(opts.handle, 72),
    h(
      "div",
      { class: "profile-head-text" },
      h("p", { class: "profile-handle" }, opts.handle),
      h("span", { class: "profile-badge" }, "Anônimo"),
    ),
  );

  const note = h(
    "p",
    { class: "field-hint" },
    "Seus dados só são salvos na nuvem depois de conectar com o Discord.",
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

  const body = h("div", { class: "dialog-form" });
  append(body, [
    header,
    connect,
    note,
    nick.el,
    full.el,
    appearance,
    palette,
    h("div", { class: "dialog-actions" }, close, save),
  ]);

  const dlg = openDialog({ title: "Seu perfil", body: [body] });
  close.addEventListener("click", () => dlg.close());
  connect.addEventListener("click", () => {
    toast("O login com Discord chega na próxima fase (L3).");
  });
}
