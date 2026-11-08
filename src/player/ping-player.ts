import "./bootstrap";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";

import "./components/live-badge";
import "./components/theater-button";
import "./components/stats-button";
import "./components/quality-menu";
import "./components/fps-menu";
import "./components/chat-button";
import "./components/osd";

import { PingLiveBadge } from "./components/live-badge";
import { PingTheaterButton } from "./components/theater-button";
import { PingStatsButton } from "./components/stats-button";
import { PingQualityMenu } from "./components/quality-menu";
import { PingFpsMenu } from "./components/fps-menu";
import { PingChatButton } from "./components/chat-button";
import { PingOsd } from "./components/osd";
import type { QualityPreset } from "../protocol";

export interface PingPlayerOptions {
  onQualityChange?: (preset: QualityPreset) => void;
  onQualityCycle?: () => void;
  onFpsChange?: (fps: "auto" | number) => void;
  onOpenStats?: () => void;
  onChatToggle?: () => void;
  onTheaterChange?: () => void;
  onMuteToggle?: () => void;
  onFullscreenToggle?: () => void;
}

export class PingPlayer {
  private player: Player;
  private videoEl: HTMLVideoElement;
  private qualityMenu!: PingQualityMenu;
  private fpsMenu!: PingFpsMenu;
  private theaterBtn!: PingTheaterButton;
  public chatBtn!: PingChatButton;
  public statsBtn!: PingStatsButton;
  public liveBadge!: PingLiveBadge;
  private osd!: PingOsd;
  private onKeyDownBound: (e: KeyboardEvent) => void;

  constructor(targetEl: HTMLVideoElement | HTMLElement, opts: PingPlayerOptions = {}) {
    const isVideo = targetEl.tagName === "VIDEO";
    if (isVideo) {
      this.videoEl = targetEl as HTMLVideoElement;
    } else {
      this.videoEl = document.createElement("video");
      this.videoEl.id = "v";
      this.videoEl.playsInline = true;
      this.videoEl.autoplay = true;
      this.videoEl.muted = true;
      targetEl.appendChild(this.videoEl);
    }

    this.videoEl.classList.add("video-js", "vjs-default-skin", "ping-skin");

    this.player = videojs(this.videoEl, {
      controls: true,
      fill: true,
      responsive: true,
      liveui: false,
      preload: "auto",
      autoplay: "muted",
      userActions: {
        hotkeys: false,
      },
      controlBar: {
        progressControl: false,
        playToggle: false,
        liveDisplay: false,
        seekToLive: false,
        remainingTimeDisplay: false,
        currentTimeDisplay: false,
        durationDisplay: false,
        timeDivider: false,
        subsCapsButton: false,
        audioTrackButton: false,
        chaptersButton: false,
        descriptionsButton: false,
        pictureInPictureToggle: true,
        fullscreenToggle: true,
      },
      textTrackSettings: false,
    });

    this.setupComponents();
    this.setupEvents(opts);

    const wrapper = this.player.el();
    if (wrapper) {
      wrapper.id = "vjs-stage";
    }
    const tech = (this.player.tech(true) as any)?.el?.() || this.videoEl;
    if (tech) {
      tech.id = "v";
      tech.setAttribute("playsinline", "");
      this.videoEl = tech as HTMLVideoElement;
    }

    this.onKeyDownBound = (e: KeyboardEvent) => this.handleKeyDown(e, opts);
    window.addEventListener("keydown", this.onKeyDownBound, true);
  }

  private setupComponents() {
    const cb = this.player.getChild("controlBar");
    if (cb) {
      const cbEl = cb.el();
      if (cbEl && !cbEl.id) {
        cbEl.id = "bar";
      }

      // Link para voltar ao Lobby
      const leaveLink = document.createElement("a");
      leaveLink.id = "leave";
      leaveLink.href = "/";
      leaveLink.className = "btn-leave-room vjs-control";
      leaveLink.title = "Sair da sala e voltar ao Lobby";
      leaveLink.textContent = "← Salas";
      cbEl.insertBefore(leaveLink, cbEl.firstChild);

      // Live Badge no início, logo após o botão de voltar às salas
      this.liveBadge = cb.addChild("PingLiveBadge", {}, 0) as PingLiveBadge;
      cbEl.insertBefore(leaveLink, cbEl.firstChild);

      // Botões customizados à direita
      this.qualityMenu = cb.addChild("PingQualityMenu", {}) as unknown as PingQualityMenu;
      this.fpsMenu = cb.addChild("PingFpsMenu", {}) as unknown as PingFpsMenu;
      this.statsBtn = cb.addChild("PingStatsButton", {}) as unknown as PingStatsButton;
      this.chatBtn = cb.addChild("PingChatButton", {}) as unknown as PingChatButton;
      this.theaterBtn = cb.addChild("PingTheaterButton", {}) as unknown as PingTheaterButton;

      // Adiciona IDs aos botões padrão e posiciona no extremo direito
      const pipComp = cb.getChild("pictureInPictureToggle");
      if (pipComp) {
        const pipEl = pipComp.el();
        if (pipEl) {
          pipEl.id = "pip";
          pipEl.setAttribute("title", "Janela flutuante / Popout (P)");
          pipEl.setAttribute("aria-label", "Assistir em janela flutuante (Popout)");
          pipEl.textContent = "Popout";
          cbEl.appendChild(pipEl);
        }
      }

      const fsComp = cb.getChild("fullscreenToggle");
      if (fsComp) {
        const fsEl = fsComp.el();
        if (fsEl) {
          fsEl.id = "fs";
          fsEl.setAttribute("title", "Alternar tela cheia (F)");
          cbEl.appendChild(fsEl);
        }
      }
    }

    // OSD Overlay no player
    this.osd = this.player.addChild("PingOsd", {}) as PingOsd;
  }

  private setupEvents(opts: PingPlayerOptions) {
    this.player.on("qualitychange", (_e: any, data: { preset: QualityPreset }) => {
      opts.onQualityChange?.(data.preset);
    });

    this.player.on("fpschange", (_e: any, data: { fps: "auto" | number }) => {
      opts.onFpsChange?.(data.fps);
    });

    this.player.on("openstatsmodal", () => {
      opts.onOpenStats?.();
    });

    this.player.on("chattoggle", () => {
      opts.onChatToggle?.();
    });

    this.player.on("theatermodechange", () => {
      opts.onTheaterChange?.();
    });
  }

  private handleKeyDown(e: KeyboardEvent, opts: PingPlayerOptions) {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }

    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const key = e.key.toLowerCase();
    switch (key) {
      case "m": {
        e.preventDefault();
        if (opts.onMuteToggle) {
          opts.onMuteToggle();
        } else {
          const isMuted = this.player.muted();
          this.player.muted(!isMuted);
          this.showToast(!isMuted ? "Áudio mutado" : "Áudio ativado");
        }
        break;
      }
      case "f": {
        e.preventDefault();
        if (opts.onFullscreenToggle) {
          opts.onFullscreenToggle();
        } else {
          if (this.player.isFullscreen()) {
            this.player.exitFullscreen();
          } else {
            this.player.requestFullscreen();
          }
        }
        break;
      }
      case "t": {
        e.preventDefault();
        opts.onTheaterChange?.();
        break;
      }
      case "p": {
        e.preventDefault();
        const pipComp = this.player.getChild("controlBar")?.getChild("pictureInPictureToggle") as any;
        if (pipComp && typeof pipComp.handleClick === "function") {
          pipComp.handleClick(e);
        }
        break;
      }
      case "q": {
        e.preventDefault();
        if (opts.onQualityCycle) {
          opts.onQualityCycle();
        } else {
          const el = this.qualityMenu?.el();
          if (el) {
            const btn = (el.querySelector("button") || el) as HTMLElement;
            btn.focus?.();
            btn.click?.();
          }
        }
        break;
      }
      case "s": {
        e.preventDefault();
        this.osd?.toggle();
        break;
      }
      case "d": {
        e.preventDefault();
        opts.onOpenStats?.();
        break;
      }
      case "c": {
        e.preventDefault();
        opts.onChatToggle?.();
        break;
      }
    }
  }

  attachStream(stream: MediaStream): void {
    this.player.ready(() => {
      const tech = this.player.tech(true) as any;
      const el = (tech?.el?.() || this.videoEl) as HTMLVideoElement;
      el.srcObject = stream;
      const playPromise = el.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn("[PingPlayer] Autoplay prevented:", err);
          this.osd?.showUnmutePrompt();
        });
      }
    });
  }

  setQuality(preset: QualityPreset): void {
    this.qualityMenu?.setPreset(preset);
  }

  setFps(fps: "auto" | number): void {
    this.fpsMenu?.setFps(fps);
  }

  setHostMaxFps(maxFps: number): void {
    this.fpsMenu?.setHostMaxFps(maxFps);
  }

  showToast(text: string, durationMs = 2500): void {
    this.osd?.showToast(text, durationMs);
  }

  showState(state: "paused" | "stopped" | "reconnecting" | "live" | "none", message?: string): void {
    this.osd?.showState(state, message);
    if (this.liveBadge && typeof (this.liveBadge as any).setState === "function") {
      (this.liveBadge as any).setState(state === "paused" ? "paused" : state === "reconnecting" ? "reconnecting" : "live");
    }
  }

  setTheaterState(isTheater: boolean): void {
    this.theaterBtn?.setTheaterState(isTheater);
  }

  setChatUnread(count: number): void {
    this.chatBtn?.setUnread(count);
  }

  setChatActive(isOpen: boolean): void {
    this.chatBtn?.setActive(isOpen);
  }

  getVideoElement(): HTMLVideoElement {
    return this.videoEl;
  }

  getPlayer(): Player {
    return this.player;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDownBound, true);
    try {
      this.player.dispose();
    } catch {
      // ignore
    }
  }
}
