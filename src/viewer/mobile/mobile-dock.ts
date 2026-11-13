import { renderAvatar } from "../../app/avatar";
import type { QualityPreset } from "../../protocol";
import { copyText } from "../../ui";
import { createMobileIcon } from "./mobile-icons";

export type StreamUiState =
  | "connecting"
  | "live"
  | "buffering"
  | "reconnecting"
  | "unstable"
  | "paused"
  | "ended"
  | "failed";

export interface MobileDockOptions {
  container: HTMLElement;
  headerEl: HTMLElement;
  palcoLayout: HTMLElement;
  stageEl: HTMLElement;
  videoEl: HTMLVideoElement;
  room: string;
  onToggleAudio: () => void;
  onToggleChat: () => void;
  onToggleFullscreen: () => void;
  onOpenQuality: () => void;
  onOpenStats: () => void;
  onToggleFit: () => void;
  onToggleRotate: () => void;
}

const PRESET_SHORT: Record<QualityPreset, string> = {
  source: "Auto",
  "720p": "720p",
  "480p": "480p",
  "360p": "360p",
};

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mm = String(mins).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

export class MobileDock {
  private headerTitleEl: HTMLElement;
  private headerStatusEl: HTMLElement;
  private streamInfoEl: HTMLElement;
  private avatarMountEl: HTMLElement;
  private roomNameEl: HTMLElement;
  private hostNameEl: HTMLElement;
  private viewersEl: HTMLElement;
  private durationEl: HTMLElement;
  private connBadgeEl: HTMLElement;

  private actionsWrapEl: HTMLElement;
  private audioBtn: HTMLButtonElement;
  private audioLabel: HTMLElement;
  private chatBtn: HTMLButtonElement;
  private chatBadge: HTMLElement;
  private fsBtn: HTMLButtonElement;

  private qualityBtn: HTMLButtonElement;
  private qualityLabel: HTMLElement;
  private statsBtn: HTMLButtonElement;
  private fitBtn: HTMLButtonElement;
  private fitLabel: HTMLElement;
  private rotateBtn: HTMLButtonElement;
  private rotateLabel: HTMLElement;
  private shareBtn: HTMLButtonElement;
  private shareLabel: HTMLElement;

  private bufferingPill: HTMLElement;
  private durationTimer: number | undefined;
  private liveStartedAt: number | null = null;
  private baseViewportHeight = window.innerHeight;
  private onViewportResize: () => void;
  private onVideoMeta: () => void;
  private onVideoWaiting: () => void;
  private onVideoPlaying: () => void;
  private destroyed = false;

  constructor(private readonly opts: MobileDockOptions) {
    // 1. Header compact room title + single status pill
    this.headerTitleEl = document.createElement("span");
    this.headerTitleEl.id = "mobile-room-title";
    this.headerTitleEl.className = "mobile-header-title";
    this.headerTitleEl.textContent = "Transmissão ao vivo";

    this.headerStatusEl = document.createElement("span");
    this.headerStatusEl.id = "mobile-header-status";
    this.headerStatusEl.className = "mobile-header-status";
    this.headerStatusEl.dataset.state = "connecting";
    this.headerStatusEl.textContent = "Conectando";

    const backLink = this.opts.headerEl.querySelector(".btn-viewer-back");
    if (backLink) {
      backLink.after(this.headerTitleEl);
    } else {
      this.opts.headerEl.appendChild(this.headerTitleEl);
    }
    this.opts.headerEl.appendChild(this.headerStatusEl);

    // 2. Buffering pill inside player stage
    this.bufferingPill = document.createElement("div");
    this.bufferingPill.id = "mobile-buffering-pill";
    this.bufferingPill.className = "mobile-buffering-pill";
    this.bufferingPill.hidden = true;
    this.bufferingPill.appendChild(createMobileIcon("refresh-cw", 14));
    const bufText = document.createElement("span");
    bufText.textContent = "Carregando vídeo…";
    this.bufferingPill.appendChild(bufText);
    this.opts.stageEl.appendChild(this.bufferingPill);

    // 3. Stream Information section (below player)
    this.streamInfoEl = document.createElement("section");
    this.streamInfoEl.id = "mobile-stream-info";
    this.streamInfoEl.className = "mobile-stream-info";
    this.streamInfoEl.setAttribute("aria-label", "Informações da transmissão");

    this.avatarMountEl = document.createElement("div");
    this.avatarMountEl.className = "mobile-stream-info__avatar";
    this.avatarMountEl.appendChild(renderAvatar({ name: "Anfitrião", size: "md" }));

    const infoText = document.createElement("div");
    infoText.className = "mobile-stream-info__text";

    this.roomNameEl = document.createElement("h1");
    this.roomNameEl.id = "mobile-info-room";
    this.roomNameEl.className = "mobile-stream-info__title";
    this.roomNameEl.textContent = "Sala ao vivo";

    const subRow = document.createElement("div");
    subRow.className = "mobile-stream-info__sub";

    this.hostNameEl = document.createElement("span");
    this.hostNameEl.id = "mobile-info-host";
    this.hostNameEl.textContent = "Transmissão P2P";

    this.viewersEl = document.createElement("span");
    this.viewersEl.id = "mobile-info-viewers";
    this.viewersEl.className = "mobile-stream-info__viewers";
    this.viewersEl.hidden = true;

    this.durationEl = document.createElement("span");
    this.durationEl.id = "mobile-duration";
    this.durationEl.className = "mobile-stream-info__duration";
    this.durationEl.hidden = true;

    subRow.appendChild(this.hostNameEl);
    subRow.appendChild(this.viewersEl);
    subRow.appendChild(this.durationEl);

    infoText.appendChild(this.roomNameEl);
    infoText.appendChild(subRow);

    this.connBadgeEl = document.createElement("span");
    this.connBadgeEl.id = "mobile-conn-pill";
    this.connBadgeEl.className = "mobile-conn-pill";
    this.connBadgeEl.dataset.level = "connecting";
    this.connBadgeEl.textContent = "Conectando";

    this.streamInfoEl.appendChild(this.avatarMountEl);
    this.streamInfoEl.appendChild(infoText);
    this.streamInfoEl.appendChild(this.connBadgeEl);

    // 4. Primary & Secondary Actions
    this.actionsWrapEl = document.createElement("section");
    this.actionsWrapEl.id = "mobile-actions-bar";
    this.actionsWrapEl.className = "mobile-actions-bar";
    this.actionsWrapEl.setAttribute("aria-label", "Controles da transmissão");

    const primaryRow = document.createElement("div");
    primaryRow.id = "mobile-primary-actions";
    primaryRow.className = "mobile-primary-actions";

    // Primary 1: Audio
    this.audioBtn = document.createElement("button");
    this.audioBtn.id = "mobile-audio-btn";
    this.audioBtn.type = "button";
    this.audioBtn.className = "mobile-action-btn mobile-action-btn--primary";
    this.audioBtn.setAttribute("aria-pressed", "false");
    this.audioBtn.appendChild(createMobileIcon("volume-x", 18));
    this.audioLabel = document.createElement("span");
    this.audioLabel.textContent = "Ativar som";
    this.audioBtn.appendChild(this.audioLabel);
    this.audioBtn.addEventListener("click", () => this.opts.onToggleAudio());

    // Primary 2: Chat
    this.chatBtn = document.createElement("button");
    this.chatBtn.id = "mobile-chat-btn";
    this.chatBtn.type = "button";
    this.chatBtn.className = "mobile-action-btn mobile-action-btn--primary";
    this.chatBtn.setAttribute("aria-pressed", "false");
    this.chatBtn.appendChild(createMobileIcon("message-square", 18));
    const chatLabel = document.createElement("span");
    chatLabel.textContent = "Chat";
    this.chatBtn.appendChild(chatLabel);
    this.chatBadge = document.createElement("span");
    this.chatBadge.id = "mobile-chat-badge";
    this.chatBadge.className = "mobile-action-badge";
    this.chatBadge.hidden = true;
    this.chatBtn.appendChild(this.chatBadge);
    this.chatBtn.addEventListener("click", () => this.opts.onToggleChat());

    // Primary 3: Fullscreen
    this.fsBtn = document.createElement("button");
    this.fsBtn.id = "mobile-fs-btn";
    this.fsBtn.type = "button";
    this.fsBtn.className = "mobile-action-btn mobile-action-btn--primary";
    this.fsBtn.setAttribute("aria-pressed", "false");
    this.fsBtn.appendChild(createMobileIcon("maximize-2", 18));
    const fsLabel = document.createElement("span");
    fsLabel.textContent = "Tela cheia";
    this.fsBtn.appendChild(fsLabel);
    this.fsBtn.addEventListener("click", () => this.opts.onToggleFullscreen());

    primaryRow.appendChild(this.audioBtn);
    primaryRow.appendChild(this.chatBtn);
    primaryRow.appendChild(this.fsBtn);

    // Secondary Actions Row
    const secondaryRow = document.createElement("div");
    secondaryRow.id = "mobile-secondary-actions";
    secondaryRow.className = "mobile-secondary-actions";

    this.qualityBtn = this.makeSecondaryBtn("mobile-quality-btn", "sliders", "Auto");
    this.qualityLabel = this.qualityBtn.querySelector("span")!;
    this.qualityBtn.setAttribute("aria-label", "Selecionar qualidade de vídeo");
    this.qualityBtn.addEventListener("click", () => this.opts.onOpenQuality());

    this.statsBtn = this.makeSecondaryBtn("mobile-stats-btn", "bar-chart-2", "Status");
    this.statsBtn.setAttribute("aria-label", "Estatísticas da conexão");
    this.statsBtn.addEventListener("click", () => this.opts.onOpenStats());

    this.fitBtn = this.makeSecondaryBtn("mobile-fit-btn", "expand", "Preencher");
    this.fitLabel = this.fitBtn.querySelector("span")!;
    this.fitBtn.setAttribute("aria-label", "Ajustar ou preencher tela do vídeo");
    this.fitBtn.addEventListener("click", () => this.opts.onToggleFit());

    this.rotateBtn = this.makeSecondaryBtn("mobile-rotate-btn", "refresh-cw", "Deitar");
    this.rotateLabel = this.rotateBtn.querySelector("span")!;
    this.rotateBtn.setAttribute("aria-label", "Deitar tela para assistir na horizontal");
    this.rotateBtn.setAttribute("aria-pressed", "false");
    this.rotateBtn.addEventListener("click", () => this.opts.onToggleRotate());

    this.shareBtn = this.makeSecondaryBtn("mobile-share-btn", "share-2", "Compartilhar");
    this.shareLabel = this.shareBtn.querySelector("span")!;
    this.shareBtn.setAttribute("aria-label", "Compartilhar ou copiar link da sala");
    this.shareBtn.addEventListener("click", () => {
      void this.handleShare();
    });

    secondaryRow.appendChild(this.qualityBtn);
    secondaryRow.appendChild(this.statsBtn);
    secondaryRow.appendChild(this.fitBtn);
    secondaryRow.appendChild(this.rotateBtn);
    secondaryRow.appendChild(this.shareBtn);

    this.actionsWrapEl.appendChild(primaryRow);
    this.actionsWrapEl.appendChild(secondaryRow);

    // Insert right after stageEl inside palcoLayout (above chat-panel!)
    this.opts.stageEl.after(this.streamInfoEl, this.actionsWrapEl);

    // Aspect ratio & buffering listeners
    this.onVideoMeta = (): void => {
      const vw = this.opts.videoEl.videoWidth;
      const vh = this.opts.videoEl.videoHeight;
      if (vw > 0 && vh > 0) {
        const ratio = Math.max(0.5, Math.min(2.4, vw / vh));
        this.opts.stageEl.style.setProperty("--stream-aspect", ratio.toFixed(4));
      }
    };
    this.onVideoWaiting = (): void => {
      if (this.liveStartedAt !== null) {
        this.bufferingPill.hidden = false;
      }
    };
    this.onVideoPlaying = (): void => {
      this.bufferingPill.hidden = true;
    };

    this.opts.videoEl.addEventListener("loadedmetadata", this.onVideoMeta);
    this.opts.videoEl.addEventListener("resize", this.onVideoMeta);
    this.opts.videoEl.addEventListener("waiting", this.onVideoWaiting);
    this.opts.videoEl.addEventListener("stalled", this.onVideoWaiting);
    this.opts.videoEl.addEventListener("playing", this.onVideoPlaying);
    this.opts.videoEl.addEventListener("canplay", this.onVideoPlaying);

    // Virtual keyboard detection (visualViewport)
    this.onViewportResize = (): void => {
      const vv = window.visualViewport;
      if (!vv) return;
      if (vv.height > this.baseViewportHeight) {
        this.baseViewportHeight = vv.height;
      }
      const isKeyboard =
        window.innerWidth <= 900 &&
        this.baseViewportHeight - vv.height > 140 &&
        document.activeElement?.tagName === "INPUT";
      this.opts.container.classList.toggle("keyboard-open", isKeyboard);
    };
    window.visualViewport?.addEventListener("resize", this.onViewportResize);

    // Fetch real room metadata (non-blocking)
    void this.fetchRoomMetadata();
  }

  private makeSecondaryBtn(
    id: string,
    icon: "sliders" | "bar-chart-2" | "expand" | "refresh-cw" | "share-2",
    label: string,
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.id = id;
    btn.type = "button";
    btn.className = "mobile-secondary-btn";
    btn.appendChild(createMobileIcon(icon, 16));
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);
    return btn;
  }

  private async fetchRoomMetadata(): Promise<void> {
    try {
      const res = await fetch("/api/rooms", { cache: "no-store" });
      if (!res.ok || this.destroyed) return;
      const data = (await res.json()) as {
        rooms?: Array<{ id: string; name?: string; host?: string; viewers?: number }>;
      };
      const found = data.rooms?.find((r) => r.id === this.opts.room);
      if (!found || this.destroyed) return;
      if (found.name) {
        this.roomNameEl.textContent = found.name;
        this.headerTitleEl.textContent = found.name;
      }
      if (found.host) {
        this.hostNameEl.textContent = found.host;
        this.avatarMountEl.replaceChildren(renderAvatar({ name: found.host, size: "md" }));
      }
      if (typeof found.viewers === "number" && found.viewers >= 0) {
        this.setViewerCount(found.viewers);
      }
    } catch {
      // Metadata opcional; mantém fallback limpo
    }
  }

  private async handleShare(): Promise<void> {
    const shareUrl = window.location.href;
    const title = this.roomNameEl.textContent || "Transmissão no PING";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url: shareUrl });
        return;
      } catch {
        // Fallback para copiar link se cancelado ou indisponível
      }
    }
    const ok = await copyText(shareUrl);
    if (ok) {
      this.shareLabel.textContent = "Copiado!";
      window.setTimeout(() => {
        if (!this.destroyed) this.shareLabel.textContent = "Compartilhar";
      }, 2000);
    }
  }

  setViewerCount(count: number): void {
    if (count > 0) {
      this.viewersEl.hidden = false;
      this.viewersEl.textContent = count === 1 ? "· 1 assistindo" : `· ${count} assistindo`;
    } else {
      this.viewersEl.hidden = true;
    }
  }

  setStreamState(state: StreamUiState, detail?: string): void {
    this.headerStatusEl.dataset.state = state;
    this.connBadgeEl.dataset.level = state;

    const labels: Record<StreamUiState, string> = {
      connecting: "Conectando",
      live: "AO VIVO",
      buffering: "Carregando",
      reconnecting: "Reconectando",
      unstable: "Instável",
      paused: "Pausada",
      ended: "Encerrada",
      failed: "Desconectado",
    };

    this.headerStatusEl.textContent = labels[state];
    this.connBadgeEl.textContent = detail || labels[state];

    if (state === "live" && this.liveStartedAt === null) {
      this.liveStartedAt = Date.now();
      this.durationEl.hidden = false;
      this.durationEl.textContent = "· 00:00";
      this.durationTimer = window.setInterval(() => {
        if (this.liveStartedAt !== null) {
          const elapsed = (Date.now() - this.liveStartedAt) / 1000;
          this.durationEl.textContent = `· ${formatDuration(elapsed)}`;
        }
      }, 1000);
    }

    if (state === "ended" || state === "failed") {
      this.bufferingPill.hidden = true;
      if (this.durationTimer !== undefined) {
        window.clearInterval(this.durationTimer);
        this.durationTimer = undefined;
      }
    }
  }

  syncAudio(muted: boolean): void {
    this.audioBtn.classList.toggle("is-active", !muted);
    this.audioBtn.setAttribute("aria-pressed", String(!muted));
    this.audioLabel.textContent = muted ? "Ativar som" : "Som ativo";
    const oldIcon = this.audioBtn.querySelector("svg");
    const nextIcon = createMobileIcon(muted ? "volume-x" : "volume-2", 18);
    if (oldIcon) oldIcon.replaceWith(nextIcon);
  }

  syncChat(isOpen: boolean, unreadCount: number): void {
    this.chatBtn.classList.toggle("is-active", isOpen);
    this.chatBtn.setAttribute("aria-pressed", String(isOpen));
    if (!isOpen && unreadCount > 0) {
      this.chatBadge.hidden = false;
      this.chatBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    } else {
      this.chatBadge.hidden = true;
    }
  }

  syncQuality(preset: QualityPreset): void {
    this.qualityLabel.textContent = PRESET_SHORT[preset];
  }

  syncFullscreen(isExpanded: boolean): void {
    this.fsBtn.classList.toggle("is-active", isExpanded);
    this.fsBtn.setAttribute("aria-pressed", String(isExpanded));
  }

  syncFit(isCover: boolean): void {
    this.fitBtn.classList.toggle("is-active", isCover);
    this.fitLabel.textContent = isCover ? "Original" : "Preencher";
  }

  syncRotate(isRotated: boolean): void {
    this.rotateBtn.classList.toggle("is-active", isRotated);
    this.rotateBtn.setAttribute("aria-pressed", String(isRotated));
    this.rotateLabel.textContent = isRotated ? "Normal" : "Deitar";
  }

  destroy(): void {
    this.destroyed = true;
    if (this.durationTimer !== undefined) {
      window.clearInterval(this.durationTimer);
      this.durationTimer = undefined;
    }
    this.opts.videoEl.removeEventListener("loadedmetadata", this.onVideoMeta);
    this.opts.videoEl.removeEventListener("resize", this.onVideoMeta);
    this.opts.videoEl.removeEventListener("waiting", this.onVideoWaiting);
    this.opts.videoEl.removeEventListener("stalled", this.onVideoWaiting);
    this.opts.videoEl.removeEventListener("playing", this.onVideoPlaying);
    this.opts.videoEl.removeEventListener("canplay", this.onVideoPlaying);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
  }
}
