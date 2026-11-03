import { Avatar, Badge, Skeleton } from "./primitives";
import { debounce, h, icon } from "./dom";
import type { Room } from "./services/rooms";

export type NavId = "rooms" | "create" | "profile";

const NAV_ITEMS: { id: NavId; label: string; icon: string }[] = [
  { id: "rooms", label: "Salas", icon: "home" },
  { id: "create", label: "Criar", icon: "plus" },
  { id: "profile", label: "Perfil", icon: "user" },
];

/* ---------- SidebarNav ---------- */
export interface SidebarApi {
  el: HTMLElement;
  setActive(id: NavId): void;
  updateProfile(p: { displayName: string; handle: string; discordLinked?: boolean; discordUsername?: string }): void;
}

export function SidebarNav(opts: {
  handle: string;
  onNavigate: (id: NavId) => void;
}): SidebarApi {
  const items = NAV_ITEMS.map((it) =>
    h(
      "button",
      {
        type: "button",
        class: "nav-item",
        "data-nav": it.id,
        "aria-label": it.label,
        title: it.label,
        onClick: () => opts.onNavigate(it.id),
      },
      icon(it.icon, 20),
      h("span", { class: "nav-label" }, it.label),
    ),
  );

  const avatarWrap = h("span", { class: "profile-avatar-wrap" }, Avatar(opts.handle, 36));
  const nameEl = h("span", { class: "profile-name" }, opts.handle);
  const badgeEl = h("span", { class: "profile-badge" }, "Anônimo");
  const profileBtn = h(
    "button",
    {
      type: "button",
      class: "profile-card",
      "aria-label": `Abrir perfil de ${opts.handle}`,
      onClick: () => opts.onNavigate("profile"),
    },
    avatarWrap,
    h("span", { class: "profile-text" }, nameEl, badgeEl),
  );

  const el = h(
    "aside",
    { class: "sidebar" },
    h(
      "div",
      { class: "brand-row" },
      h("span", { class: "live-dot", "aria-hidden": "true" }),
      h("span", { class: "brand-name" }, "Ping"),
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-primary btn-block sidebar-create",
        id: "sidebar-create",
        "aria-label": "Criar sala",
        onClick: () => opts.onNavigate("create"),
      },
      icon("plus", 16),
      h("span", { class: "btn-label" }, "Criar Sala"),
    ),
    h("nav", { class: "nav-list", "aria-label": "Principal" }, ...items),
    profileBtn,
  );

  const updateProfile = (p: { displayName: string; handle: string; discordLinked?: boolean; discordUsername?: string }) => {
    profileBtn.setAttribute("aria-label", `Abrir perfil de ${p.displayName}`);
    avatarWrap.replaceChildren(Avatar(p.displayName, 36));
    nameEl.textContent = p.displayName;
    badgeEl.textContent = p.discordLinked
      ? (p.discordUsername ? `@${p.discordUsername}` : "Discord")
      : (p.displayName === p.handle ? "Anônimo" : "Personalizado");
  };

  window.addEventListener("ping:profile-updated", (e: Event) => {
    const custom = e as CustomEvent<{ displayName: string; handle: string; discordLinked?: boolean; discordUsername?: string }>;
    if (custom.detail) updateProfile(custom.detail);
  });

  return {
    el,
    setActive(id) {
      items.forEach((b) => {
        const on = b.dataset.nav === id;
        if (on) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
    },
    updateProfile,
  };
}

/* ---------- BottomNav (mobile) ---------- */
export function BottomNav(onNavigate: (id: NavId) => void): HTMLElement {
  return h(
    "nav",
    { class: "bottom-nav", "aria-label": "Principal (celular)" },
    ...NAV_ITEMS.map((it) =>
      h(
        "button",
        {
          type: "button",
          class: "bottom-item",
          "data-nav": it.id,
          onClick: () => onNavigate(it.id),
        },
        icon(it.icon, 20),
        h("span", {}, it.label),
      ),
    ),
  );
}

export function setBottomActive(nav: HTMLElement, id: NavId): void {
  nav.querySelectorAll<HTMLElement>(".bottom-item").forEach((b) => {
    if (b.dataset.nav === id) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}

/* ---------- RoomCard ---------- */
export function describeRoom(room: Room): string {
  const kind = room.isPrivate ? "Sala fechada" : "Sala aberta";
  const full = room.viewers >= room.capacity;
  return `${kind}, ${room.viewers} de ${room.capacity} vagas${full ? ", lotada" : ""}`;
}

export function RoomCard(room: Room, onSelect: (room: Room) => void): HTMLElement {
  const full = room.viewers >= room.capacity;
  const count = `${room.viewers} / ${room.capacity}${full ? " Lotada" : ""}`;
  const card = h(
    "button",
    {
      type: "button",
      class: `room-card${full ? " is-full" : ""}`,
      "data-room-id": room.id,
      "aria-label": `${describeRoom(room)}. ${room.name}, sala de ${room.host}`,
      "aria-disabled": full ? "true" : undefined,
      onClick: () => {
        onSelect(room);
      },
    },
    Avatar(room.host, 40),
    h(
      "span",
      { class: "room-text" },
      h("span", { class: "room-name" }, room.name),
      h("span", { class: "room-host" }, `Sala de ${room.host}`),
    ),
    Badge(room.isPrivate ? "closed" : "open", count, full),
  );
  return card;
}

export function RoomCardSkeleton(): HTMLElement {
  return h(
    "div",
    { class: "room-card is-skeleton", "aria-hidden": "true" },
    Skeleton("sk-avatar"),
    h("span", { class: "room-text" }, Skeleton("sk-line sk-line-lg"), Skeleton("sk-line sk-line-sm")),
    Skeleton("sk-pill"),
  );
}

/* ---------- SearchInput ---------- */
export function SearchInput(onChange: (query: string) => void): HTMLElement {
  const input = h("input", {
    class: "search-input",
    type: "text",
    placeholder: "Buscar salas pelo nome…",
    "aria-label": "Buscar salas",
    autocomplete: "off",
    spellcheck: "false",
  });
  const clear = h("button", {
    type: "button",
    class: "search-clear",
    "aria-label": "Limpar busca",
    hidden: true,
  });
  clear.append(icon("x", 16));
  const kbd = h("kbd", { class: "search-kbd", "aria-hidden": "true" }, "/");

  const notify = debounce(() => onChange(input.value), 150);
  const sync = (): void => {
    clear.hidden = input.value.length === 0;
    kbd.hidden = input.value.length > 0;
  };
  const reset = (): void => {
    input.value = "";
    sync();
    onChange("");
  };

  input.addEventListener("input", () => {
    sync();
    notify();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && input.value) {
      e.stopPropagation();
      reset();
    }
  });
  clear.addEventListener("click", () => {
    reset();
    input.focus();
  });

  const onGlobalKey = (e: KeyboardEvent) => {
    if (!input.isConnected) {
      document.removeEventListener("keydown", onGlobalKey);
      return;
    }
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
    if (document.querySelector("dialog[open]")) return;
    if (!input.offsetParent) return;
    e.preventDefault();
    input.focus();
  };
  document.addEventListener("keydown", onGlobalKey);

  const wrap = h("div", { class: "search", role: "search" }, icon("search", 18), input, kbd, clear);
  return wrap;
}

/* ---------- AdSlot (re-exportado do serviço especializado de anúncios) ---------- */
export {
  AdSlot,
  type AdSize,
  type AdProvider,
  PlaceholderAdProvider,
  DirectSponsorAdProvider,
  setAdProvider,
  getAdProvider,
} from "./services/ads";

/* ---------- Estados globais ---------- */
export function Banner(
  kind: "warn" | "error",
  text: string,
  action?: { label: string; onClick: () => void },
): HTMLElement {
  return h(
    "div",
    { class: `banner banner-${kind}`, role: kind === "error" ? "alert" : "status" },
    h("span", {}, text),
    action
      ? h("button", { type: "button", class: "btn btn-secondary btn-sm", onClick: action.onClick }, action.label)
      : null,
  );
}

export function EmptyState(
  title: string,
  text: string,
  action?: { label: string; onClick: () => void },
): HTMLElement {
  return h(
    "div",
    { class: "empty" },
    h("p", { class: "empty-title" }, title),
    h("p", { class: "empty-text" }, text),
    action
      ? h("button", { type: "button", class: "btn btn-primary", onClick: action.onClick }, action.label)
      : null,
  );
}
