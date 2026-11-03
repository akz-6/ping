
import { toast } from "../ui";
import {
  AdSlot,
  BottomNav,
  Banner,
  EmptyState,
  RoomCard,
  RoomCardSkeleton,
  SearchInput,
  SidebarNav,
  setBottomActive,
  type NavId,
} from "./components";
import { h, normalize } from "./dom";
import { getHandle, getProfile } from "./identity";
import { openCreateRoomModal, openPasswordModal, openProfileModal } from "./modals";
import { isCreatorAuthorized, openTestingNoticeModal } from "./auth-gate";
import { MAX_OPEN_ROOMS, createRoomService, type Room } from "./services/rooms";
import { getConsentStatus, openConsentBanner } from "./services/ads";

type Status = "loading" | "ready" | "error";

export function mountApp(root: HTMLElement): void {
  const service = createRoomService();
  const handle = getProfile().displayName || getHandle();

  let rooms: Room[] = [];
  let status: Status = "loading";
  let query = "";
  let view: "lobby" | "host" = "lobby";

  const feed = h("div", { class: "feed" });
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
      // O host mantém conexões abertas: recarregar é a forma segura de encerrá-las.
      window.location.assign(window.location.pathname);
      return;
    }
    setActive("rooms");
  };

  const showHost = async (password?: string, roomId?: string, hostToken?: string): Promise<void> => {
    view = "host";
    lobby.hidden = true;
    hostView.hidden = false;
    hostView.replaceChildren();
    const { mountHost } = await import("../host");
    mountHost(hostView, { password, roomId, hostToken });
    setActive("create");
    window.scrollTo({ top: 0 });
    document.getElementById("ping-consent-banner")?.remove();
    adsRight.hidden = true;
  };

  const onCreate = (): void => {
    const isOwner = isCreatorAuthorized();
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
    else if (id === "profile") openProfileModal({ handle, onSaved: (p) => sidebar.updateProfile(p) });
    else showLobby();
  };

  const sidebar = SidebarNav({ handle, onNavigate: navigate });
  const bottom = BottomNav(navigate);

  const search = SearchInput((q) => {
    query = q;
    render();
  });

  function section(title: string, list: Room[], opts: { chip?: string; skeletons: number; counter: { n: number } }): HTMLElement {
    const head = h("div", { class: "section-head" }, h("h2", { class: "section-title" }, title));
    if (opts.chip) head.append(h("span", { class: "chip" }, opts.chip));
    const items = h("div", { class: "room-list" });

    if (status === "loading") {
      for (let i = 0; i < opts.skeletons; i++) items.append(RoomCardSkeleton());
    } else {
      for (const room of list) {
        items.append(RoomCard(room, onSelect));
        opts.counter.n += 1;
        if (opts.counter.n % 4 === 0) {
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
        EmptyState("Nenhuma sala por aqui ainda", "Seja a primeira pessoa a criar uma sala.", {
          label: "Criar Sala",
          onClick: onCreate,
        }),
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

  lobby.append(
    h(
      "div",
      { class: "m-header" },
      h("span", { class: "live-dot", "aria-hidden": "true" }),
      h("span", { class: "brand-name" }, "Ping"),
    ),
    search,
    live,
    feed,
  );

  const main = h("main", { class: "main", id: "main" }, lobby, hostView);
  const adsRight = h(
    "aside",
    { class: "ads-right", "aria-label": "Publicidade" },
    AdSlot("300x250"),
    AdSlot("300x600"),
  );
  const adsBelow = h("aside", { class: "ads-below", "aria-label": "Publicidade" }, AdSlot("300x250"));
  main.append(adsBelow);

  root.replaceChildren(h("div", { class: "app" }, sidebar.el, main, adsRight, bottom));
  setActive("rooms");
  void load();

  const isHostParam = new URLSearchParams(location.search).get("host") === "1";
  if (!isHostParam && getConsentStatus() === "prompt") {
    openConsentBanner();
  }

  if (new URLSearchParams(location.search).get("host") === "1") {
    if (isCreatorAuthorized()) {
      showHost("");
    } else {
      openTestingNoticeModal({
        onAuthorized: () => {
          toast("Máquina autorizada com sucesso!");
          showHost("");
        },
      });
    }
  }
}
