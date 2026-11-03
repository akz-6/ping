import { mountHost } from "../host";
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
import { getHandle } from "./identity";
import { openCreateRoomModal, openPasswordModal, openProfileModal } from "./modals";
import { MAX_OPEN_ROOMS, createRoomService, type Room } from "./services/rooms";

type Status = "loading" | "ready" | "error";

export function mountApp(root: HTMLElement): void {
  const service = createRoomService();
  const handle = getHandle();

  let rooms: Room[] = [];
  let status: Status = "loading";
  let query = "";
  let view: "lobby" | "host" = "lobby";

  const feed = h("div", { class: "feed" });
  const live = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
  const lobby = h("section", { class: "lobby" });
  const hostView = h("section", { class: "host-view legacy", hidden: true });

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

  const showHost = (password: string): void => {
    view = "host";
    lobby.hidden = true;
    hostView.hidden = false;
    hostView.replaceChildren();
    mountHost(hostView, { password });
    setActive("create");
    window.scrollTo({ top: 0 });
  };

  const onCreate = (): void => {
    openCreateRoomModal({
      openCount,
      onCreate: async (name, password) => {
        await service.create({ name, password, host: handle });
        showHost(password);
      },
    });
  };

  const onSelect = (room: Room): void => {
    if (room.isPrivate) {
      openPasswordModal({
        room,
        verify: (pw) => service.verifyPassword(room.id, pw),
        onSuccess: () => toast("Senha correta. As salas deste lobby ainda são de demonstração (backend na fase L2)."),
      });
    } else {
      toast("Esta é uma sala de demonstração. O lobby real chega com o backend (fase L2).");
    }
  };

  const navigate = (id: NavId): void => {
    if (id === "create") onCreate();
    else if (id === "profile") openProfileModal({ handle });
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
      feed.append(EmptyState("Nenhuma sala encontrada", "Tente buscar por outro nome."));
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

  if (new URLSearchParams(location.search).get("host") === "1") showHost("");
}
