import { h, icon } from "./dom";

/* ---------- Button ---------- */
export type ButtonVariant = "primary" | "secondary" | "discord";

export function Button(
  label: string,
  opts: {
    variant?: ButtonVariant;
    type?: "button" | "submit";
    block?: boolean;
    onClick?: (e: Event) => void;
    id?: string;
  } = {},
): HTMLButtonElement {
  const btn = h(
    "button",
    {
      class: `btn btn-${opts.variant ?? "primary"}${opts.block ? " btn-block" : ""}`,
      type: opts.type ?? "button",
      id: opts.id,
      onClick: opts.onClick,
    },
    h("span", { class: "btn-label" }, label),
  );
  return btn;
}

export function setLoading(btn: HTMLButtonElement, loading: boolean): void {
  btn.toggleAttribute("data-loading", loading);
  btn.setAttribute("aria-busy", String(loading));
  btn.disabled = loading;
}

/* ---------- Avatar ---------- */
export function Avatar(name: string, size: 36 | 40 | 72 = 40): HTMLElement {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const clean = name.trim();
  const hash = clean.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const colorIdx = hash % 6;
  return h("span", { class: `avatar avatar-${size} avatar-c${colorIdx}`, "aria-hidden": "true" }, initial);
}

/* ---------- Badge ---------- */
export function Badge(
  kind: "open" | "closed",
  text: string,
  full: boolean,
): HTMLElement {
  return h(
    "span",
    { class: `badge badge-${kind}${full ? " badge-full" : ""}` },
    icon(kind === "open" ? "unlock" : "lock", 12),
    h("span", {}, text),
  );
}

/* ---------- Skeleton ---------- */
export function Skeleton(className = ""): HTMLElement {
  return h("span", { class: `skeleton ${className}`.trim(), "aria-hidden": "true" });
}

/* ---------- Field (input com rótulo, erro e olho opcional) ---------- */
export interface FieldApi {
  el: HTMLElement;
  input: HTMLInputElement;
  setError(msg: string | null): void;
  setDisabled(disabled: boolean): void;
}

let fieldSeq = 0;

export function Field(opts: {
  label: string;
  placeholder?: string;
  type?: "text" | "password";
  hint?: string;
  required?: boolean;
  maxLength?: number;
  autocomplete?: string;
}): FieldApi {
  const id = `field-${++fieldSeq}`;
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const input = h("input", {
    id,
    class: "input",
    type: opts.type ?? "text",
    placeholder: opts.placeholder,
    maxlength: opts.maxLength,
    autocomplete: opts.autocomplete ?? "off",
    spellcheck: "false",
  });
  if (opts.hint) input.setAttribute("aria-describedby", hintId);

  const error = h("p", { class: "field-error", id: errId, role: "alert", hidden: true });
  const wrap = h("div", { class: "input-wrap" }, input);

  if (opts.type === "password") {
    const eye = h("button", {
      type: "button",
      class: "input-eye",
      "aria-label": "Mostrar senha",
      "aria-pressed": "false",
    });
    eye.append(icon("eye", 18));
    eye.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.setAttribute("aria-pressed", String(show));
      eye.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
      eye.replaceChildren(icon(show ? "eye-off" : "eye", 18));
    });
    wrap.append(eye);
  }

  const el = h(
    "div",
    { class: "field" },
    h("label", { class: "field-label", for: id }, opts.label),
    wrap,
    opts.hint ? h("p", { class: "field-hint", id: hintId }, opts.hint) : null,
    error,
  );

  return {
    el,
    input,
    setError(msg) {
      error.hidden = msg === null;
      error.textContent = msg ?? "";
      input.toggleAttribute("aria-invalid", msg !== null);
      const described = [opts.hint ? hintId : "", msg ? errId : ""].filter(Boolean).join(" ");
      if (described) input.setAttribute("aria-describedby", described);
      else input.removeAttribute("aria-describedby");
    },
    setDisabled(d) {
      input.disabled = d;
      el.classList.toggle("field-disabled", d);
    },
  };
}

/* ---------- Dialog (elemento <dialog> nativo) ---------- */
export interface DialogApi {
  el: HTMLDialogElement;
  close(): void;
  setBusy(busy: boolean): void;
}

export function openDialog(opts: {
  title: string;
  subtitle?: string;
  body: Node[];
  onClose?: () => void;
}): DialogApi {
  const titleId = `dlg-title-${++fieldSeq}`;
  let busy = false;

  const dlg = h(
    "dialog",
    { class: "dialog", "aria-labelledby": titleId },
    h(
      "div",
      { class: "dialog-panel" },
      h("h2", { class: "dialog-title", id: titleId }, opts.title),
      opts.subtitle ? h("p", { class: "dialog-sub" }, opts.subtitle) : null,
      ...opts.body,
    ),
  );

  const finish = (): void => {
    document.documentElement.classList.remove("scroll-lock");
    dlg.remove();
    opts.onClose?.();
  };

  dlg.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  dlg.addEventListener("close", finish);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg && !busy) dlg.close();
  });

  document.body.append(dlg);
  document.documentElement.classList.add("scroll-lock");
  dlg.showModal();

  // Foco inicial no primeiro campo (senão no primeiro botão).
  const first = dlg.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled])");
  first?.focus();

  return {
    el: dlg,
    close: () => dlg.close(),
    setBusy(b) {
      busy = b;
    },
  };
}
