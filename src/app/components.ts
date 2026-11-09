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
  updateProfile(p: {
    displayName: string;
    handle: string;
    discordLinked?: boolean;
    discordUsername?: string;
    avatarUrl?: string;
  }): void;
}

export function SidebarNav(opts: {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
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

  const initialName = opts.displayName || opts.handle;
  const avatarWrap = h("span", { class: "profile-avatar-wrap" }, Avatar(initialName, 40, opts.avatarUrl));
  const nameEl = h("span", { class: "profile-name" }, initialName);
  const badgeEl = h("span", { class: "profile-badge" }, "Anônimo");
  const profileBtn = h(
    "button",
    {
      type: "button",
      class: "profile-card sidebar__profile ping-user-card",
      "data-action": "open-profile",
      "aria-label": `Abrir perfil de ${initialName}`,
      onClick: () => opts.onNavigate("profile"),
    },
    avatarWrap,
    h("span", { class: "profile-text profile-info ping-user-card__info" }, nameEl, badgeEl),
  );

  const el = h(
    "aside",
    { class: "sidebar ping-nav ping-sidebar" },
    h(
      "div",
      { class: "sidebar__brand brand-row ping-logo ping-brand brand-name" },
      h(
        "div",
        { class: "sidebar__logo-card ping-brand__logo-frame" },
        h("img", {
          src: "/branding/ping-logo.png",
          alt: "PING",
          class: "sidebar__logo ping-brand__logo",
        }),
      ),
      h("span", { class: "sr-only" }, "Ping"),
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-primary btn-block sidebar-create button button--primary sidebar__create ping-button ping-button--primary ping-sidebar__create",
        id: "sidebar-create",
        "data-action": "create-room",
        "aria-label": "Criar sala",
        onClick: () => opts.onNavigate("create"),
      },
      icon("plus", 17),
      h("span", { class: "btn-label" }, "Criar Sala"),
    ),
    h("nav", { class: "nav-list sidebar__navigation ping-navigation", "aria-label": "Principal" }, ...items),
    profileBtn,
  );

  const updateProfile = (p: {
    displayName: string;
    handle: string;
    discordLinked?: boolean;
    discordUsername?: string;
    avatarUrl?: string;
  }) => {
    profileBtn.setAttribute("aria-label", `Abrir perfil de ${p.displayName}`);
    avatarWrap.replaceChildren(Avatar(p.displayName, 40, p.avatarUrl));
    nameEl.textContent = p.displayName;
    if (p.discordLinked) {
      profileBtn.setAttribute("data-verified", "true");
      badgeEl.setAttribute("data-verified", "true");
    } else {
      profileBtn.removeAttribute("data-verified");
      badgeEl.removeAttribute("data-verified");
    }
    badgeEl.textContent = p.discordLinked
      ? (p.discordUsername ? `@${p.discordUsername}` : "Discord")
      : (p.displayName === p.handle ? "Anônimo" : "Personalizado");
  };

  window.addEventListener("ping:profile-updated", (e: Event) => {
    const custom = e as CustomEvent<{
      displayName: string;
      handle: string;
      discordLinked?: boolean;
      discordUsername?: string;
      avatarUrl?: string;
    }>;
    if (custom.detail) updateProfile(custom.detail);
  });

  return {
    el,
    setActive(id) {
      items.forEach((b) => {
        const on = b.dataset.nav === id;
        if (on) {
          b.setAttribute("aria-current", "page");
          b.classList.add("nav-item--active");
        } else {
          b.removeAttribute("aria-current");
          b.classList.remove("nav-item--active");
        }
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
    Avatar(room.host, 40, (room as any).hostAvatarUrl),
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

  const wrap = h("div", { class: "search search-box", role: "search" }, icon("search", 18), input, kbd, clear);
  return wrap;
}

/* ---------- Hero Banner da Tela Inicial ---------- */
export function LobbyHero(opts: {
  onCreate: () => void;
  onExplore: () => void;
}): HTMLElement {
  return h(
    "section",
    { class: "lobby-hero hero" },
    h(
      "div",
      { class: "lobby-hero__badge" },
      h("img", {
        src: "/branding/ping-logo.png",
        alt: "PING",
        class: "lobby-hero__logo",
      }),
    ),
    h(
      "div",
      { class: "lobby-hero__content" },
      h("h1", { class: "lobby-hero__title" }, "Sua gameplay. Sua sala. Sua galera."),
      h(
        "p",
        { class: "lobby-hero__desc" },
        "Crie salas, compartilhe sua tela e conecte-se com seus amigos.",
      ),
      h(
        "div",
        { class: "lobby-hero__actions" },
        h(
          "button",
          {
            type: "button",
            class: "btn btn-primary button button--primary",
            onClick: opts.onCreate,
          },
          icon("plus", 16),
          h("span", {}, "Criar Sala"),
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn btn-secondary button button--secondary",
            onClick: opts.onExplore,
          },
          icon("search", 16),
          h("span", {}, "Explorar Salas"),
        ),
      ),
    ),
  );
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
      ? h("button", { type: "button", class: "btn btn-secondary btn-sm button button--secondary", onClick: action.onClick }, action.label)
      : null,
  );
}

export function EmptyState(
  title: string,
  text: string,
  action?: { label: string; onClick: () => void },
): HTMLElement {
  const iconWrap = document.createElement("div");
  iconWrap.className = "ping-empty-state__icon";
  iconWrap.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="6" width="38" height="27" rx="4" /><path d="M17 42h14M24 33v9" /><path d="m21 15 9 4.5-9 4.5z" /></svg>`;

  return h(
    "div",
    { class: "empty empty-state ping-empty-state" },
    iconWrap,
    h("h2", { class: "empty-title" }, title),
    h("p", { class: "empty-text" }, text),
    action
      ? h(
          "button",
          {
            type: "button",
            class: "btn btn-primary button button--primary ping-button ping-button--primary",
            onClick: action.onClick,
          },
          action.label,
        )
      : null,
  );
}
