import { FriendsService } from "../social/friends-service";
import { mountFriendsPanel } from "../social/friends-panel";
import type { PingProfile } from "../social/types";
import type { UserProfile } from "./identity";

import { toast } from "../ui";
import {
  AdSlot,
  BottomNav,
  Banner,
  EmptyState,
  LobbyHero,
  RoomCard,
  RoomCardSkeleton,
  SearchInput,
  SidebarNav,
  setBottomActive,
  type NavId,
} from "./components";
import { h, icon, normalize } from "./dom";
import { getHandle, getProfile, syncDiscordSession } from "./identity";
import { openCreateRoomModal, openPasswordModal, openProfileModal } from "./modals";
import { isCreatorAuthorized, openTestingNoticeModal, checkUrlForCreatorKey } from "./auth-gate";
import { MAX_OPEN_ROOMS, createRoomService, type Room } from "./services/rooms";
import { getConsentStatus, openConsentBanner } from "./services/ads";

type Status = "loading" | "ready" | "error";

export function mountApp(root: HTMLElement, options?: { initialView?: "lobby" | "host" }): void {
  const friendsService = new FriendsService();
  const friendsContainer = h("div", { class: "friends-panel-wrap" });

  let unmountFriends: (() => void) | null = null;
  const updateFriends = (p: UserProfile, configured = true) => {
    unmountFriends?.();
    const pingProf: PingProfile | null = (p.discordLinked && p.discordId)
      ? {
          discordId: p.discordId,
          username: p.discordUsername || p.handle,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl || "",
        }
      : null;
    unmountFriends = mountFriendsPanel({
      root: friendsContainer,
      service: friendsService,
      profile: pingProf,
      discordConfigured: configured,
      toast: (msg, kind) => toast(msg, kind || "info"),
    });
  };

  const service = createRoomService();
  const handle = getProfile().displayName || getHandle();

  let rooms: Room[] = [];
  let status: Status = "loading";
  let query = "";
  let view: "lobby" | "host" = "lobby";

  const feed = h("div", { class: "feed rooms-section" });
  document.title = "Ping — Salas ao Vivo";
  const live = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const lobby = h("section", { class: "lobby" });
  const hostView = h("section", { class: "host-view legacy", hidden: true });

  const resetSearch = (): void => {
    query = "";
    const input = search.querySelector<HTMLInputElement>(".search-input");
    if (input) {
      input.value = "";
      const clearBtn = search.querySelector<HTMLButtonElement>(".search-clear");
      const kbd = search.querySelector<HTMLElement>(".search-kbd");
      if (clearBtn) clearBtn.hidden = true;
      if (kbd) kbd.hidden = false;
    }
    render();
  };

  const openCount = (): number => rooms.filter((r) => !r.isPrivate).length;

  const setActive = (id: NavId): void => {
    sidebar.setActive(id);
    setBottomActive(bottom, id);
  };

  const showLobby = (): void => {
    if (view === "host") {
      const broadcasting = hostView.querySelector<HTMLElement>("#live:not([hidden])");
      if (broadcasting && !window.confirm("Encerrar a transmissão atual e voltar às salas?")) return;
      const stopBtn = hostView.querySelector<HTMLButtonElement>("#stop");
      if (stopBtn && broadcasting) {
        stopBtn.click();
      }
      view = "lobby";
      if (location.pathname.startsWith("/studio")) {
        history.pushState({ view: "lobby" }, "", "/" + (location.search ? location.search : ""));
      }
      hostView.hidden = true;
      lobby.hidden = false;
      adsRight.hidden = false;
      setActive("rooms");
      void load();
      return;
    }
    setActive("rooms");
    void load();
  };

  const showHost = async (password?: string, roomId?: string, hostToken?: string): Promise<void> => {
    view = "host";
    if (location.pathname !== "/studio") {
      history.pushState({ view: "host" }, "", "/studio" + (location.search ? location.search : ""));
    }
    lobby.hidden = true;
    hostView.hidden = false;
    hostView.replaceChildren();
    const { mountHost } = await import("../host");
    mountHost(hostView, {
      password,
      roomId,
      hostToken,
      onExit: () => showLobby(),
    });
    setActive("create");
    window.scrollTo({ top: 0 });
    document.getElementById("ping-consent-banner")?.remove();
    adsRight.hidden = true;
  };

  const onCreate = async (): Promise<void> => {
    await checkUrlForCreatorKey();
    const profile = getProfile();
    const isOwner = isCreatorAuthorized() || Boolean(profile.isOwner);
    const currentOpen = openCount();

    if (currentOpen >= MAX_OPEN_ROOMS && !isOwner) {
      openTestingNoticeModal({
        title: "Limite de Salas Atingido",
        subtitle: `O limite de ${MAX_OPEN_ROOMS} salas abertas foi atingido. Somente o dono/anfitrião com a senha mestra pode criar novas salas.`,
        onAuthorized: () => {
          toast("Dono autenticado com sucesso!");
          onCreate();
        },
      });
      return;
    }

    if (!isOwner) {
      openTestingNoticeModal({
        onAuthorized: () => {
          toast("Máquina autorizada com sucesso!");
          onCreate();
        },
      });
      return;
    }
    openCreateRoomModal({
      openCount,
      isOwner,
      onCreate: async (name, password) => {
        const created = await service.create({ name, password, host: handle, isOwner });
        showHost(password, created.id, created.hostToken);
      },
    });
  };

  const onSelect = (room: Room): void => {
    if (room.viewers >= room.capacity) {
      toast(`A sala "${room.name}" está cheia (${room.capacity} / ${room.capacity} vagas ocupadas).`, "info");
      return;
    }

    const enter = () => {
      location.href = `/?room=${encodeURIComponent(room.id)}`;
    };

    if (room.isPrivate) {
      openPasswordModal({
        room,
        verify: (pw) => service.verifyPassword(room.id, pw),
        onSuccess: () => {
          if (room.id === "demo-fechada-teste") {
            toast("Senha correta. Esta é uma sala fake para teste.", "info");
          } else {
            toast("Senha correta. Conectando à sala...");
            enter();
          }
        },
      });
    } else {
      if (room.id === "demo-publica-lotada") {
        toast(`A sala "${room.name}" é uma sala de demonstração.`);
      } else {
        enter();
      }
    }
  };

  const navigate = (id: NavId): void => {
    if (id === "create") onCreate();
    else if (id === "profile") openProfileModal({ handle, onSaved: (p) => { sidebar.updateProfile(p); updateFriends(p); } });
    else showLobby();
  };

  const sidebar = SidebarNav({ handle, onNavigate: navigate });
  sidebar.updateProfile(getProfile());
  const bottom = BottomNav(navigate);

  const search = SearchInput((q) => {
    query = q;
    render();
  });

  const hero = LobbyHero({
    onCreate,
    onExplore: () => {
      const input = search.querySelector<HTMLInputElement>(".search-input");
      input?.focus();
      feed.scrollIntoView({ behavior: "smooth" });
    },
  });

  function section(title: string, list: Room[], opts: { chip?: string; skeletons: number; counter: { n: number } }): HTMLElement {
    const head = h("div", { class: "section-head section-header" }, h("h2", { class: "section-title" }, title));
    if (opts.chip) head.append(h("span", { class: "chip" }, opts.chip));
    const items = h("div", { class: "room-list rooms-container" });

    if (status === "loading") {
      for (let i = 0; i < opts.skeletons; i++) items.append(RoomCardSkeleton());
    } else {
      for (const room of list) {
        items.append(RoomCard(room, onSelect));
        opts.counter.n += 1;
        if (opts.counter.n === 6) {
          items.append(h("div", { class: "ad-inline" }, AdSlot("320x100")));
        }
      }
    }
    return h("section", { class: "section" }, head, items);
  }

  function render(): void {
    feed.replaceChildren();
    const q = normalize(query);
    const match = (r: Room): boolean => !q || normalize(r.name).includes(q) || normalize(r.host).includes(q);

    // Oculta o Hero caso o usuário esteja pesquisando para focar nos resultados
    if (q) {
      hero.hidden = true;
    } else {
      hero.hidden = false;
    }

    if (status === "error") {
      feed.append(
        Banner("error", "Não foi possível carregar as salas.", { label: "Tentar novamente", onClick: load }),
      );
      return;
    }

    const open = rooms.filter((r) => !r.isPrivate);
    const closed = rooms.filter((r) => r.isPrivate);
    const shownOpen = open.filter(match);
    const shownClosed = closed.filter(match);

    if (status === "ready" && rooms.length === 0) {
      feed.append(
        EmptyState("Nenhuma sala por aqui ainda", "As salas disponíveis aparecerão aqui quando forem criadas."),
      );
      live.textContent = "Nenhuma sala aberta.";
      return;
    }

    if (status === "ready" && q && shownOpen.length + shownClosed.length === 0) {
      feed.append(
        EmptyState("Nenhuma sala encontrada", "Tente buscar por outro nome.", {
          label: "Limpar busca",
          onClick: resetSearch,
        }),
      );
      return;
    }

    const counter = { n: 0 };
    feed.append(
      section("Salas Abertas", shownOpen, { chip: `${open.length} / ${MAX_OPEN_ROOMS}`, skeletons: 3, counter }),
      section("Salas Fechadas", shownClosed, { skeletons: 2, counter }),
    );
    if (status === "ready") live.textContent = `${open.length} de ${MAX_OPEN_ROOMS} salas abertas.`;
  }

  async function load(): Promise<void> {
    status = "loading";
    render();
    try {
      rooms = await service.list();
      status = "ready";
    } catch {
      status = "error";
    }
    render();
  }

  service.subscribe((next) => {
    rooms = next;
    if (status === "ready") render();
  });

  const pageHeading = h(
    "section",
    { class: "ping-page-heading page-heading" },
    h(
      "div",
      {},
      h("h1", {}, "Salas"),
      h("p", {}, "Encontre amigos ou crie sua própria sala."),
    ),
    h(
      "button",
      {
        type: "button",
        class: "ping-button ping-button--primary btn btn-primary heading-create",
        "data-action": "create-room",
        onClick: onCreate,
      },
      icon("plus", 17),
      h("span", {}, "Criar Sala"),
    ),
  );

  const searchTopbar = h("header", { class: "ping-topbar topbar" }, search);
  const roomsSection = h("section", { class: "ping-rooms", "aria-label": "Salas disponíveis" }, feed);

  lobby.append(
    searchTopbar,
    pageHeading,
    live,
    roomsSection,
  );

  const main = h("main", { class: "main main-content ping-main", id: "main" }, lobby, hostView);
  const adsRight = h(
    "aside",
    { class: "ads-right ping-rail friends-panel-container ping-friends-panel", "aria-label": "Painel Lateral e Amigos" },
    friendsContainer,
    AdSlot("300x250"),
    AdSlot("300x600"),
  );
  const adsBelow = h("aside", { class: "ads-below", "aria-label": "Publicidade" }, AdSlot("300x250"));
  main.append(adsBelow);

  const lobbyFooter = h(
    "footer",
    { class: "lobby-footer footer ping-footer", role: "contentinfo" },
    h(
      "nav",
      { class: "lobby-footer-links" },
      h("a", { href: "/privacy.html", class: "lobby-footer-link" }, "Privacidade"),
      h("span", { class: "lobby-footer-sep", "aria-hidden": "true" }, "•"),
      h("a", { href: "/terms.html", class: "lobby-footer-link" }, "Termos"),
      h("span", { class: "lobby-footer-sep", "aria-hidden": "true" }, "•"),
      h("a", { href: "/contact.html", class: "lobby-footer-link" }, "Contato"),
    ),
    h(
      "p",
      { class: "lobby-footer-copy" },
      "PING © 2026 — Transmissão WebRTC peer-to-peer de alta performance.",
    ),
  );

  const contentGrid = h("div", { class: "ping-content-grid content-grid" }, main, adsRight);
  const workspace = h("div", { class: "ping-workspace workspace" }, contentGrid, lobbyFooter);

  root.replaceChildren(h("div", { class: "app ping-shell app-shell ping-app" }, sidebar.el, workspace, bottom));
  setActive("rooms");
  void load();

  const searchParams = new URLSearchParams(location.search);
  const loginParam = searchParams.get("login");
  if (loginParam) {
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("login");
    cleanUrl.searchParams.delete("reason");
    history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search);
    if (loginParam === "ok") {
      void syncDiscordSession().then((p) => {
        if (p) updateFriends(p);
        toast(`Conectado ao Discord com sucesso! (@${p.discordUsername || "user"})`);
      });
    } else {
      toast("Falha na autenticação com o Discord.", "error");
    }
  } else {
    void syncDiscordSession().then((p) => {
      if (p) updateFriends(p);
    });
    fetch("/api/discord-auth?action=status")
      .then((r) => r.json())
      .then((d) => updateFriends(getProfile(), Boolean(d?.configured)))
      .catch(() => updateFriends(getProfile(), false));
  }

  window.addEventListener("popstate", () => {
    if (location.pathname.startsWith("/studio") && view !== "host") {
      void showHost("");
    } else if (!location.pathname.startsWith("/studio") && view === "host") {
      showLobby();
    }
  });

  const isStudioRoute = location.pathname.startsWith("/studio") || options?.initialView === "host";
  const isHostParam = new URLSearchParams(location.search).get("host") === "1";

  if (!isHostParam && !isStudioRoute && getConsentStatus() === "prompt") {
    openConsentBanner();
  }

  if (isStudioRoute || isHostParam) {
    void checkUrlForCreatorKey().then(() => {
      if (isCreatorAuthorized()) {
        void showHost("");
      } else {
        openTestingNoticeModal({
          onAuthorized: () => {
            toast("Máquina autorizada com sucesso!");
            void showHost("");
          },
        });
      }
    });
  }
}
