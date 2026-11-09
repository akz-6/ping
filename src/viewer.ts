import { Peer, type DataConnection, type MediaConnection } from "peerjs";
import {
  CONNECT_TIMEOUT_MS,
  hasTurn,
  peerOptions,
  fetchIceServers,
  ROOM_PATTERN,
} from "./config";
import {
  hashPassword,
  parseToViewer,
  type DeniedReason,
  type QualityPreset,
  type ToHost,
} from "./protocol";
import {
  CircularBuffer,
  StatsSampler,
  type ConnectionQuality,
  type ViewerDiagnosticSample,
} from "./stats";
import { $, copyText, shortId } from "./ui";
import { PingPlayer } from "./player/ping-player";
import { ChatUi } from "./chat/chat-ui";
import { getDiscordTicket, getProfile } from "./app/identity";
import {
  createViewerTransport,
  type ViewerTransport,
} from "./transport";

const MAX_RECONNECT_ATTEMPTS = 5;
const BACKOFF_MS = [1000, 2000, 3000, 5000, 8000];
const BAR_HIDE_MS = 3000;

type FailureReason = "signaling" | "ice" | "peer-unavailable";

function formatQualityLabel(q: ConnectionQuality): string {
  switch (q) {
    case "poor":
      return "Ruim";
    case "fair":
      return "Média";
    case "good":
    default:
      return "Boa";
  }
}

const PRESET_LABELS: Record<QualityPreset, string> = {
  source: "Auto (Original)",
  "720p": "720p (Rápido)",
  "480p": "480p (Mais Rápido)",
  "360p": "360p (Super Leve)",
};

const PRESET_ORDER: QualityPreset[] = ["source", "720p", "480p", "360p"];

function formatDeniedMessage(reason: DeniedReason | undefined): string {
  switch (reason) {
    case "wrong-password":
      return "Acesso negado: limite de tentativas de senha excedido.";
    case "blocked":
      return "Você foi bloqueado pelo anfitrião.";
    case "full":
      return "Sala cheia. O limite de espectadores foi atingido.";
    case "rejected":
    default:
      return "Entrada recusada pelo anfitrião.";
  }
}

const TEMPLATE = `
<main class="viewer ping-stage" id="stage" aria-label="Reprodutor da transmissão" data-chat="visible" data-theater="false">
  <div class="palco-layout ping-stage__frame" id="palco">
    <div class="palco-stage ping-stage__player" id="stage-inner">
      <video id="v" autoplay playsinline muted></video>
  <div id="pause-overlay" class="paused-overlay" hidden>
    <div class="paused-card">
      <span class="paused-icon">⏸️</span>
      <p class="paused-title">Transmissão Pausada</p>
      <p class="paused-sub">O anfitrião pausou o compartilhamento de tela momentaneamente.</p>
    </div>
  </div>
  <div id="discord-stats-modal" class="discord-stats-modal" hidden>
    <div class="discord-stats-panel">
      <div class="discord-stats-header">
        <span class="discord-stats-title">📶 Estatísticas da Transmissão</span>
        <button id="close-stats" type="button" class="discord-close-btn" aria-label="Fechar estatísticas">✕</button>
      </div>
      <div class="discord-stats-grid">
        <div class="discord-stat-item">
          <span class="stat-label">Qualidade</span>
          <span class="stat-val status-ok" id="ds-status">Boa</span>
        </div>
        <div class="discord-stat-item">
          <span class="stat-label">Latência (RTT)</span>
          <span class="stat-val" id="ds-rtt">— ms</span>
        </div>
        <div class="discord-stat-item">
          <span class="stat-label">Bitrate de Entrada</span>
          <span class="stat-val" id="ds-bitrate">— Mbps</span>
        </div>
        <div class="discord-stat-item">
          <span class="stat-label">Taxa de Quadros</span>
          <span class="stat-val" id="ds-fps">— FPS</span>
        </div>
        <div class="discord-stat-item">
          <span class="stat-label">Codec de Vídeo</span>
          <span class="stat-val" id="ds-codec">—</span>
        </div>
        <div class="discord-stat-item">
          <span class="stat-label">Protocolo</span>
          <span class="stat-val">WebRTC P2P</span>
        </div>
        <div class="discord-stat-item">
          <span class="stat-label">Perfil Escolhido</span>
          <span class="stat-val" id="ds-preset">Auto (Original)</span>
        </div>
        <div class="discord-stat-item">
          <span class="stat-label">FPS Escolhido</span>
          <span class="stat-val" id="ds-chosen-fps">Auto</span>
        </div>
      </div>
    </div>
  </div>
  <div id="status" class="status" role="status" aria-live="polite">Conectando…</div>
  <div id="auth-wrap" class="status" hidden>
    <form id="auth-form" class="card auth-card">
      <h2>Sala protegida por senha</h2>
      <p id="auth-msg" class="muted">Digite a senha da sala para assistir.</p>
      <input id="auth-pw" type="password" placeholder="Senha" aria-label="Senha da sala" autocomplete="off" required />
      <button id="auth-submit" type="submit" class="primary">Entrar</button>
    </form>
  </div>
  <div class="viewer-helpers" hidden>
    <button id="sound" type="button" title="Ativar ou silenciar som (M)">Ativar som</button>
    <input id="vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" />
    <span id="quality" class="quality" data-level="good" role="status" aria-label="Qualidade da conexão: Boa" title="Qualidade da conexão">Boa</span>
    <select id="quality-preset" class="viewer-quality-select" aria-label="Ajustar qualidade para economizar internet e aumentar velocidade" title="Reduzir qualidade para aumentar velocidade (Atalho: Q)">
      <option value="source">✨ Auto (Original)</option>
      <option value="720p">⚡ 720p (Rápido)</option>
      <option value="480p">🚀 480p (Mais Rápido)</option>
      <option value="360p">🔋 360p (Super Leve)</option>
    </select>
    <select id="fps-selector" class="viewer-quality-select" aria-label="Taxa de quadros máxima (FPS)" title="Escolher FPS desejado (limitado pelo anfitrião)">
      <option value="auto">FPS: Auto</option>
      <option value="60">60 FPS</option>
      <option value="30">30 FPS</option>
      <option value="15">15 FPS</option>
    </select>
    <span id="stats" class="stats" aria-live="off"></span>
    <button id="copy-diag" type="button" class="sm" title="Copiar diagnóstico técnico da conexão em JSON">Diagnóstico</button>
  </div>
    </div>
    <div id="chat-mount"></div>
  </div>
</main>
`;

export function mountViewer(root: HTMLElement, room: string): void {
  document.title = `Ping — Transmissão (${room})`;
  root.innerHTML = TEMPLATE;

  const video = $<HTMLVideoElement>(root, "#v");
  const container = $<HTMLElement>(root, ".viewer");
  const statusEl = $<HTMLElement>(root, "#status");
  const authWrap = $<HTMLElement>(root, "#auth-wrap");
  const authForm = $<HTMLFormElement>(root, "#auth-form");
  const authMsg = $<HTMLElement>(root, "#auth-msg");
  const authPw = $<HTMLInputElement>(root, "#auth-pw");
  const authSubmit = $<HTMLButtonElement>(root, "#auth-submit");
  const soundBtn = $<HTMLButtonElement>(root, "#sound");
  const vol = $<HTMLInputElement>(root, "#vol");
  const qualityEl = $<HTMLElement>(root, "#quality");
  const statsEl = $<HTMLElement>(root, "#stats");
  const copyDiagBtn = $<HTMLButtonElement>(root, "#copy-diag");
  const pauseOverlay = $<HTMLElement>(root, "#pause-overlay");
  const discordStatsModal = $<HTMLElement>(root, "#discord-stats-modal");
  const closeStatsBtn = $<HTMLButtonElement>(root, "#close-stats");
  const dsStatus = $<HTMLElement>(root, "#ds-status");
  const dsRtt = $<HTMLElement>(root, "#ds-rtt");
  const dsBitrate = $<HTMLElement>(root, "#ds-bitrate");
  const dsFps = $<HTMLElement>(root, "#ds-fps");
  const dsCodec = $<HTMLElement>(root, "#ds-codec");
  const dsPreset = $<HTMLElement>(root, "#ds-preset");
  const qualitySelect = $<HTMLSelectElement>(root, "#quality-preset");
  const fpsSelect = $<HTMLSelectElement>(root, "#fps-selector");
  const dsChosenFps = $<HTMLElement>(root, "#ds-chosen-fps");
  const diagnosticBuffer = new CircularBuffer<ViewerDiagnosticSample>(300);

  let currentPreset: QualityPreset = "source";
  let hostMaxFps = 60;
  let currentFpsChoice: string = "auto";
  let osdTimer: number | undefined;
  let activeViewerTransport: ViewerTransport | null = null;
  let currentTransportMode: "p2p" | "sfu" = "p2p";

  let pingPlayer: PingPlayer;

  const showOsd = (text: string): void => {
    pingPlayer?.showToast(text);
  };

  const toggleTheater = (force?: boolean): void => {
    const isNow = typeof force === "boolean" ? force : !container.classList.contains("theater-mode");
    container.classList.toggle("theater-mode", isNow);
    container.dataset.theater = String(isNow);
    pingPlayer?.setTheaterState(isNow);
    const thBtn = root.querySelector<HTMLButtonElement>("#theater");
    if (thBtn) thBtn.classList.toggle("active", isNow);
    showOsd(isNow ? "🎭 Modo Teatro ativado" : "Modo Teatro normal");
  };

  const toggleStatsModal = (): void => {
    discordStatsModal.hidden = !discordStatsModal.hidden;
    if (!discordStatsModal.hidden) {
      showOsd(`📶 Estatísticas (${currentTransportMode.toUpperCase()})`);
    }
  };

  const setQualityPreset = (preset: QualityPreset, notify = true): void => {
    currentPreset = preset;
    qualitySelect.value = preset;
    dsPreset.textContent = PRESET_LABELS[preset];
    try {
      localStorage.setItem("ping_viewer_quality", preset);
    } catch {
      // ignore
    }
    if (conn && conn.open) {
      void conn.send({ t: "quality-preset", preset } satisfies ToHost);
    }
    if (notify) {
      showOsd(`Qualidade: ${PRESET_LABELS[preset]}`);
    }
    pingPlayer?.setQuality(preset);
  };

  const setFpsChoice = (choice: string, notify = true): void => {
    currentFpsChoice = choice;
    fpsSelect.value = choice;
    try {
      localStorage.setItem("ping_viewer_fps", choice);
    } catch {
      // ignore
    }

    const targetFps = choice === "auto" ? hostMaxFps : Number(choice);
    dsChosenFps.textContent = choice === "auto" ? `Auto (${hostMaxFps} FPS)` : `${choice} FPS`;

    if (conn && conn.open) {
      void conn.send({ t: "fps-cap", fps: targetFps } satisfies ToHost);
    }
    if (notify) {
      showOsd(choice === "auto" ? `FPS: Auto (${hostMaxFps} FPS)` : `FPS limitado a: ${choice} FPS`);
    }
    pingPlayer?.setFps(choice === "auto" ? "auto" : Number(choice));
  };

  const toggleMute = (): void => {
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) {
        video.volume = 1;
        vol.value = "1";
      }
      void video.play().catch(() => {
        video.muted = true;
        syncSoundUi();
      });
    } else {
      video.muted = true;
    }
    syncSoundUi();
  };

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (typeof container.requestFullscreen === "function") {
      void container.requestFullscreen().catch(() => {
        const webkitVideo = video as HTMLVideoElement & {
          webkitEnterFullscreen?: () => void;
        };
        webkitVideo.webkitEnterFullscreen?.();
      });
      return;
    }
    const webkitVideo = video as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
    };
    webkitVideo.webkitEnterFullscreen?.();
  };

  const chatMount = $<HTMLElement>(root, "#chat-mount");
  const palcoLayout = $<HTMLElement>(root, "#palco");

  let chatUi: ChatUi;
  chatUi = new ChatUi({
    initialOpen: window.innerWidth >= 900,
    onSendMessage: (text) => {
      if (conn && conn.open) {
        conn.send({ t: "chat-send", text } satisfies ToHost);
      }
    },
    onToggleChange: (isOpen) => {
      palcoLayout.classList.toggle("chat-hidden", !isOpen);
      pingPlayer?.setChatActive(isOpen);
    },
    onUnreadChange: (count) => {
      pingPlayer?.setChatUnread(count);
    },
  });
  chatMount.replaceWith(chatUi.getElement());
  palcoLayout.classList.toggle("chat-hidden", !chatUi.isChatOpen());

  pingPlayer = new PingPlayer(video, {
    onQualityChange: (preset) => setQualityPreset(preset, true),
    onQualityCycle: () => {
      const currentIdx = PRESET_ORDER.indexOf(currentPreset);
      const nextIdx = (currentIdx + 1) % PRESET_ORDER.length;
      setQualityPreset(PRESET_ORDER[nextIdx], true);
      showBarTemporarily();
    },
    onFpsChange: (fps) => setFpsChoice(String(fps), true),
    onOpenStats: () => toggleStatsModal(),
    onCloseStats: () => { discordStatsModal.hidden = true; },
    onChatToggle: () => {
      chatUi.toggleChat();
      container.dataset.chat = chatUi.isChatOpen() ? "visible" : "hidden";
    },
    onTheaterChange: () => toggleTheater(),
    onMuteToggle: () => {
      toggleMute();
      showOsd(video.muted ? "🔇 Silenciado" : "🔊 Áudio ativado");
    },
    onFullscreenToggle: () => {
      toggleFullscreen();
      showOsd(document.fullscreenElement ? "🔲 Janela normal" : "🔲 Tela cheia");
    },
  });
  pingPlayer.setChatActive(chatUi.isChatOpen());

  const osdEl = $<HTMLElement>(root, "#osd");
  const bar = $<HTMLElement>(root, "#bar");
  bar.hidden = true;
  const pipBtn = $<HTMLButtonElement>(root, "#pip");
  const fsBtn = $<HTMLButtonElement>(root, "#fs");
  const liveBadge = $<HTMLElement>(root, "#live-badge");

  const helpers = root.querySelector(".viewer-helpers");
  if (helpers && bar) {
    bar.appendChild(helpers);
    helpers.removeAttribute("hidden");
  }

  qualityEl.addEventListener("click", () => toggleStatsModal());
  qualityEl.style.cursor = "pointer";

  try {
    const saved = localStorage.getItem("ping_viewer_quality") as QualityPreset | null;
    if (saved && PRESET_ORDER.includes(saved)) {
      currentPreset = saved;
      qualitySelect.value = saved;
      dsPreset.textContent = PRESET_LABELS[saved];
      pingPlayer.setQuality(saved);
    }
  } catch {
    // ignore
  }

  qualitySelect.addEventListener("change", () => {
    const val = qualitySelect.value as QualityPreset;
    setQualityPreset(val, true);
    showBarTemporarily();
  });

  try {
    const savedFps = localStorage.getItem("ping_viewer_fps");
    if (savedFps) {
      currentFpsChoice = savedFps;
    }
  } catch {
    // ignore
  }

  const FPS_TIERS = [240, 144, 120, 60, 30, 15];

  const updateFpsSelectorOptions = (maxFps: number): void => {
    hostMaxFps = maxFps;
    const allowedTiers = FPS_TIERS.filter((f) => f <= maxFps);
    fpsSelect.replaceChildren();

    const optAuto = document.createElement("option");
    optAuto.value = "auto";
    optAuto.textContent = `FPS: Auto (${maxFps})`;
    fpsSelect.appendChild(optAuto);

    for (const fps of allowedTiers) {
      const opt = document.createElement("option");
      opt.value = String(fps);
      opt.textContent = `${fps} FPS`;
      fpsSelect.appendChild(opt);
    }

    if (currentFpsChoice !== "auto" && Number(currentFpsChoice) <= maxFps) {
      fpsSelect.value = currentFpsChoice;
      dsChosenFps.textContent = `${currentFpsChoice} FPS`;
    } else {
      fpsSelect.value = "auto";
      dsChosenFps.textContent = `Auto (${maxFps} FPS)`;
    }
    pingPlayer?.setHostMaxFps(maxFps);
  };

  fpsSelect.addEventListener("change", () => {
    setFpsChoice(fpsSelect.value, true);
    showBarTemporarily();
  });

  video.muted = true;
  video.defaultMuted = true;

  const syncSoundUi = (): void => {
    const isMuted = video.muted || video.volume === 0;
    soundBtn.textContent = isMuted ? "Ativar som" : "Silenciar";
  };
  video.addEventListener("volumechange", syncSoundUi);

  let barHideTimer: number | undefined;

  const clearBarHideTimer = (): void => {
    if (barHideTimer !== undefined) {
      window.clearTimeout(barHideTimer);
      barHideTimer = undefined;
    }
  };

  const showBarTemporarily = (): void => {
    bar.classList.add("bar-visible");
    container.classList.remove("cursor-hidden");
    clearBarHideTimer();
    barHideTimer = window.setTimeout(() => {
      barHideTimer = undefined;
      if (bar.matches(":focus-within")) return;
      bar.classList.remove("bar-visible");
      if (!bar.hidden) {
        container.classList.add("cursor-hidden");
      }
    }, BAR_HIDE_MS);
  };

  const setStatus = (msg: string, isError = false): void => {
    authWrap.hidden = true;
    statusEl.hidden = false;
    statusEl.classList.toggle("error", isError);
    statusEl.replaceChildren();
    const p = document.createElement("p");
    p.className = "status-text";
    p.textContent = msg;
    statusEl.appendChild(p);
    if (isError || finished || everConnected) {
      const backLink = document.createElement("a");
      backLink.href = "/";
      backLink.className = "btn-back-lobby";
      backLink.textContent = "← Voltar ao Lobby";
      statusEl.appendChild(backLink);
    }
  };

  if (!ROOM_PATTERN.test(room)) {
    setStatus("Link inválido.", true);
    return;
  }

  const clientId = shortId(8);
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let currentCall: MediaConnection | null = null;
  let detachCallListeners: (() => void) | null = null;
  let detachConnListeners: (() => void) | null = null;
  let savedPwHash: string | undefined;

  let gotStream = false;
  let everConnected = false;
  let finished = false;
  let reconnectAttempt = 0;
  let lastFailureReason: FailureReason = "ice";

  let attemptTimeout: number | undefined;
  let backoffTimer: number | undefined;
  let iceDisconnectTimer: number | undefined;
  let statsTimer: number | undefined;

  const clearAttemptTimeout = (): void => {
    if (attemptTimeout !== undefined) {
      window.clearTimeout(attemptTimeout);
      attemptTimeout = undefined;
    }
  };

  const clearStats = (): void => {
    if (statsTimer !== undefined) {
      window.clearInterval(statsTimer);
      statsTimer = undefined;
    }
  };

  const clearTimers = (): void => {
    clearAttemptTimeout();
    if (iceDisconnectTimer !== undefined) {
      window.clearTimeout(iceDisconnectTimer);
      iceDisconnectTimer = undefined;
    }
    clearStats();
  };

  const cleanupCurrentAttempt = (): void => {
    clearTimers();
    if (activeViewerTransport) {
      activeViewerTransport.close();
      activeViewerTransport = null;
    }
    if (detachCallListeners) {
      detachCallListeners();
      detachCallListeners = null;
    }
    if (currentCall) {
      const c = currentCall;
      currentCall = null;
      c.off("close");
      c.off("error");
      c.off("stream");
      try {
        c.close();
      } catch {
        // Ignora erro ao fechar chamada
      }
    }
    if (detachConnListeners) {
      detachConnListeners();
      detachConnListeners = null;
    }
    if (conn) {
      const d = conn;
      conn = null;
      d.off("open");
      d.off("close");
      d.off("error");
      d.off("data");
      try {
        d.close();
      } catch {
        // Ignora erro ao fechar conexão de dados
      }
    }
    if (peer) {
      const p = peer;
      peer = null;
      p.removeAllListeners();
      if (!p.destroyed) {
        p.destroy();
      }
    }
  };

  const finalMessageForReason = (reason: FailureReason): string => {
    if (reason === "peer-unavailable") {
      return everConnected
        ? "O anfitrião encerrou a transmissão."
        : "Sala não existe. Confira o link ou peça um novo ao anfitrião.";
    }
    if (reason === "signaling") {
      return "Sinalização indisponível. Verifique sua conexão ou o servidor PeerJS.";
    }
    return hasTurn()
      ? "ICE falhou mesmo com TURN configurado. Verifique sua rede ou credenciais TURN."
      : "ICE falhou (provável NAT/CGNAT). Peça ao anfitrião para configurar um servidor TURN.";
  };

  const terminate = (msg: string, isError = true): void => {
    if (finished) return;
    finished = true;
    if (activeViewerTransport) {
      activeViewerTransport.close();
      activeViewerTransport = null;
    }
    if (backoffTimer !== undefined) {
      window.clearTimeout(backoffTimer);
      backoffTimer = undefined;
    }
    clearBarHideTimer();
    if (osdTimer !== undefined) {
      window.clearTimeout(osdTimer);
      osdTimer = undefined;
    }
    if (osdEl) {
      osdEl.hidden = true;
    }
    container.classList.remove("cursor-hidden");
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("beforeunload", onBeforeUnload);
    if (document.pictureInPictureElement === video) {
      void document.exitPictureInPicture().catch(() => undefined);
    }
    cleanupCurrentAttempt();
    bar.hidden = true;
    liveBadge.hidden = true;
    pauseOverlay.hidden = true;
    discordStatsModal.hidden = true;
    video.srcObject = null;
    pingPlayer?.showState("stopped", msg);
    setStatus(msg, isError);
  };

  const scheduleReconnect = (reason: FailureReason): void => {
    if (finished) return;
    lastFailureReason = reason;

    if (backoffTimer !== undefined) return;
    cleanupCurrentAttempt();
    gotStream = false;

    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      terminate(finalMessageForReason(lastFailureReason), true);
      return;
    }

    reconnectAttempt += 1;
    const delay = BACKOFF_MS[reconnectAttempt - 1] ?? 8000;
    setStatus(
      `Conexão perdida. Reconectando (tentativa ${reconnectAttempt} de ${MAX_RECONNECT_ATTEMPTS})…`,
      false,
    );

    backoffTimer = window.setTimeout(() => {
      backoffTimer = undefined;
      if (!finished) connectAttempt();
    }, delay);
  };

  const connectAttempt = async (): Promise<void> => {
    if (finished) return;
    cleanupCurrentAttempt();
    gotStream = false;

    if (reconnectAttempt === 0) {
      setStatus("Conectando…");
    } else {
      setStatus(
        `Reconectando (tentativa ${reconnectAttempt} de ${MAX_RECONNECT_ATTEMPTS})…`,
      );
    }

    const iceServers = await fetchIceServers();
    if (finished) return;

    const p = new Peer(peerOptions(iceServers));
    peer = p;

    attemptTimeout = window.setTimeout(() => {
      if (peer !== p || gotStream || finished) return;
      const reason: FailureReason = p.open ? "ice" : "signaling";
      scheduleReconnect(reason);
    }, CONNECT_TIMEOUT_MS);

    p.on("open", async () => {
      if (peer !== p || finished) return;
      setStatus(
        reconnectAttempt > 0
          ? `Reconectando à sala (tentativa ${reconnectAttempt} de ${MAX_RECONNECT_ATTEMPTS})…`
          : "Procurando a sala…",
      );

      const myProfile = getProfile();
      let ticket: string | undefined;
      if (myProfile.discordLinked) {
        const fetched = await getDiscordTicket(p.id);
        if (fetched) ticket = fetched;
      }

      if (peer !== p || finished) return;

      const c = p.connect(room, {
        reliable: true,
        serialization: "json",
        metadata: { clientId, name: myProfile.displayName, ticket },
      });
      conn = c;

      const dataPc = c.peerConnection as RTCPeerConnection | undefined;
      const onDataIceChange = (): void => {
        if (peer !== p || finished || !dataPc) return;
        if (dataPc.iceConnectionState === "failed") {
          scheduleReconnect("ice");
        }
      };
      dataPc?.addEventListener("iceconnectionstatechange", onDataIceChange);
      detachConnListeners = (): void => {
        dataPc?.removeEventListener("iceconnectionstatechange", onDataIceChange);
      };

      c.on("open", () => {
        if (peer !== p || finished) return;
        everConnected = true;
        const helloMsg: ToHost = {
          t: "hello",
          ...(savedPwHash ? { pwHash: savedPwHash } : {}),
          ...(ticket ? { ticket } : {}),
        };
        void c.send(helloMsg);
        if (currentPreset !== "source") {
          void c.send({ t: "quality-preset", preset: currentPreset } satisfies ToHost);
        }
        if (currentFpsChoice !== "auto") {
          void c.send({ t: "fps-cap", fps: Number(currentFpsChoice) } satisfies ToHost);
        }
        if (!gotStream) {
          setStatus(
            reconnectAttempt > 0
              ? `Aguardando vídeo (tentativa ${reconnectAttempt} de ${MAX_RECONNECT_ATTEMPTS})…`
              : "Aguardando o vídeo do anfitrião…",
          );
        }
      });

      c.on("data", (data) => {
        if (peer !== p || finished) return;
        const msg = parseToViewer(data);
        if (!msg) return;

        switch (msg.t) {
          case "auth-required": {
            clearAttemptTimeout();
            statusEl.hidden = true;
            authWrap.hidden = false;
            authSubmit.disabled = false;
            authPw.disabled = false;
            if (msg.error) {
              savedPwHash = undefined;
              authMsg.textContent =
                msg.remaining !== undefined
                  ? `Senha incorreta. Tentativas restantes: ${msg.remaining}.`
                  : "Senha incorreta. Tente novamente.";
              authMsg.classList.add("error");
            } else {
              authMsg.textContent = "Digite a senha da sala para assistir.";
              authMsg.classList.remove("error");
            }
            authPw.focus();
            break;
          }

          case "pending": {
            clearAttemptTimeout();
            setStatus("Aguardando aprovação do anfitrião…", false);
            break;
          }

          case "approved":
          case "welcome": {
            authWrap.hidden = true;
            if (msg.t === "approved" && msg.transport?.mode === "sfu") {
              currentTransportMode = "sfu";
              if (activeViewerTransport) {
                activeViewerTransport.close();
                activeViewerTransport = null;
              }
              const sfuTransport = createViewerTransport({
                mode: "sfu",
                iceServers,
                onFail: (_reason) => {
                  if (conn && conn.open) {
                    conn.send({ t: "transport-fallback", reason: "sfu_failed" } satisfies ToHost);
                  }
                },
              });
              activeViewerTransport = sfuTransport;
              sfuTransport
                .connect(msg.transport)
                .then((remote) => {
                  handleStreamReceived(remote);
                })
                .catch(() => {
                  if (conn && conn.open) {
                    conn.send({ t: "transport-fallback", reason: "sfu_connect_error" } satisfies ToHost);
                  }
                });
            }
            if (msg.t === "welcome" && typeof msg.maxFps === "number") {
              updateFpsSelectorOptions(msg.maxFps);
            }
            if (currentPreset !== "source" && conn && conn.open) {
              void conn.send({ t: "quality-preset", preset: currentPreset } satisfies ToHost);
            }
            if (currentFpsChoice !== "auto" && conn && conn.open) {
              void conn.send({ t: "fps-cap", fps: Number(currentFpsChoice) } satisfies ToHost);
            }
            if (!gotStream) {
              setStatus("Aguardando o vídeo do anfitrião…", false);
              clearAttemptTimeout();
              attemptTimeout = window.setTimeout(() => {
                if (peer !== p || gotStream || finished) return;
                scheduleReconnect("ice");
              }, CONNECT_TIMEOUT_MS);
            }
            break;
          }

          case "transport-switch": {
            if (activeViewerTransport) {
              activeViewerTransport.close();
              activeViewerTransport = null;
            }
            currentTransportMode = "p2p";
            showOsd("Mudando para conexão P2P…");
            break;
          }

          case "denied": {
            savedPwHash = undefined;
            terminate(formatDeniedMessage(msg.reason), true);
            break;
          }

          case "ended": {
            terminate("O anfitrião encerrou a transmissão.", true);
            break;
          }

          case "kicked": {
            terminate("Você foi removido da sala.", true);
            break;
          }

          case "pause": {
            pauseOverlay.hidden = !msg.paused;
            showOsd(msg.paused ? "⏸️ Transmissão pausada pelo anfitrião" : "▶️ Transmissão retomada");
            break;
          }

          case "chat-history": {
            chatUi.loadHistory(msg.msgs);
            break;
          }

          case "chat-msg": {
            chatUi.addMessage(msg.msg);
            break;
          }

          case "chat-rejected": {
            if (msg.reason === "rate") {
              chatUi.showNotice("Você está enviando mensagens muito rápido. Aguarde um instante.", true);
            } else if (msg.reason === "muted") {
              chatUi.showNotice("Você foi silenciado temporariamente por 30s devido a spam.", true);
            } else {
              chatUi.showNotice("Mensagem inválida.", true);
            }
            break;
          }

          case "viewers":
            break;
        }
      });

      c.on("close", () => {
        if (peer !== p || finished) return;
        scheduleReconnect("ice");
      });

      c.on("error", () => {
        if (peer !== p || finished) return;
        scheduleReconnect("ice");
      });
    });

    const handleStreamReceived = (remote: MediaStream): void => {
      if (peer !== p || finished) return;
      pauseOverlay.hidden = true;
      if (video.srcObject !== remote) {
        video.srcObject = remote;
        pingPlayer?.attachStream(remote);
        syncSoundUi();
      }
      const tryPlay = () => {
        void video.play().catch(() => {
          video.muted = true;
          syncSoundUi();
          void video.play().catch(() => undefined);
        });
      };
      tryPlay();
      video.onloadedmetadata = tryPlay;
      gotStream = true;
      everConnected = true;
      reconnectAttempt = 0;
      if (attemptTimeout !== undefined) {
        window.clearTimeout(attemptTimeout);
        attemptTimeout = undefined;
      }
      if (iceDisconnectTimer !== undefined) {
        window.clearTimeout(iceDisconnectTimer);
        iceDisconnectTimer = undefined;
      }
      statusEl.hidden = true;
      bar.hidden = false;
      liveBadge.hidden = false;
      showBarTemporarily();
    };

    p.on("call", (call) => {
      if (peer !== p || finished) {
        call.close();
        return;
      }

      everConnected = true;

      if (detachCallListeners) {
        detachCallListeners();
        detachCallListeners = null;
      }
      if (currentCall && currentCall !== call) {
        currentCall.off("close");
        currentCall.off("error");
        currentCall.off("stream");
        currentCall.close();
        clearStats();
      }
      currentCall = call;
      call.answer();

      const pc = call.peerConnection as RTCPeerConnection | undefined;
      const onIceChange = (): void => {
        if (peer !== p || finished || !pc) return;
        const state = pc.iceConnectionState;
        if (state === "connected" || state === "completed") {
          if (iceDisconnectTimer !== undefined) {
            window.clearTimeout(iceDisconnectTimer);
            iceDisconnectTimer = undefined;
          }
          if (gotStream) {
            statusEl.hidden = true;
          }
        } else if (state === "disconnected") {
          setStatus("Conexão instável. Tentando recuperar…");
          if (iceDisconnectTimer === undefined) {
            iceDisconnectTimer = window.setTimeout(() => {
              iceDisconnectTimer = undefined;
              if (
                peer === p &&
                !finished &&
                pc.iceConnectionState === "disconnected"
              ) {
                scheduleReconnect("ice");
              }
            }, 3_000);
          }
        } else if (state === "failed" || state === "closed") {
          scheduleReconnect("ice");
        }
      };
      pc?.addEventListener("iceconnectionstatechange", onIceChange);
      detachCallListeners = (): void => {
        pc?.removeEventListener("iceconnectionstatechange", onIceChange);
      };

      call.on("stream", (remote) => {
        if (peer !== p || finished) return;
        handleStreamReceived(remote);

        if (statsTimer === undefined) {
          const sampler = new StatsSampler(call.peerConnection);
          statsTimer = window.setInterval(async () => {
            if (peer !== p || finished) return;
            const s = await sampler.sample();
            if (!s) return;
            diagnosticBuffer.push(s.diagnostic);
            const ping = s.rttMs === null ? "" : ` · ${Math.round(s.rttMs)} ms`;
            statsEl.textContent = `${s.width}×${s.height} · ${s.fps} fps · ${(s.kbps / 1000).toFixed(1)} Mbps${ping}`;
            const qLabel = formatQualityLabel(s.quality);
            qualityEl.dataset.level = s.quality;
            qualityEl.textContent = qLabel;
            qualityEl.setAttribute(
              "aria-label",
              `Qualidade da conexão: ${qLabel}`,
            );
            if (!discordStatsModal.hidden) {
              dsStatus.textContent = qLabel;
              dsStatus.className = `stat-val status-${s.quality}`;
              dsRtt.textContent = s.rttMs === null ? "—" : `${Math.round(s.rttMs)} ms`;
              dsBitrate.textContent = `${(s.kbps / 1000).toFixed(1)} Mbps`;
              dsFps.textContent = `${s.fps} FPS`;
              dsCodec.textContent = s.diagnostic.codec || "VP9";
            }
          }, 1000);
        }
      });

      call.on("close", () => {
        if (peer !== p || finished) return;
        scheduleReconnect("ice");
      });

      call.on("error", () => {
        if (peer !== p || finished) return;
        scheduleReconnect("ice");
      });
    });

    p.on("disconnected", () => {
      if (peer !== p || finished) return;
      if (!gotStream) {
        scheduleReconnect("signaling");
      } else if (!p.destroyed) {
        p.reconnect();
      }
    });

    p.on("error", (err) => {
      if (peer !== p || finished) return;
      const type = String(err.type);
      if (type === "peer-unavailable") {
        if (!everConnected) {
          terminate(
            "Sala não existe. Confira o link ou peça um novo ao anfitrião.",
            true,
          );
        } else {
          scheduleReconnect("peer-unavailable");
        }
      } else if (
        type === "browser-incompatible" ||
        type === "invalid-id" ||
        type === "invalid-key"
      ) {
        terminate(`Erro de configuração: ${type}`, true);
      } else if (type === "webrtc") {
        scheduleReconnect("ice");
      } else {
        scheduleReconnect("signaling");
      }
    });
  };

  const onOffline = (): void => {
    if (finished) return;
    scheduleReconnect("signaling");
  };

  const onOnline = (): void => {
    if (finished) return;
    if (backoffTimer !== undefined) {
      window.clearTimeout(backoffTimer);
      backoffTimer = undefined;
      connectAttempt();
    }
  };

  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (finished || !conn || !conn.open) return;
    const rawPw = authPw.value;
    if (!rawPw) return;

    authSubmit.disabled = true;
    authPw.disabled = true;
    authMsg.textContent = "Verificando senha…";
    authMsg.classList.remove("error");

    try {
      const pwHash = await hashPassword(room, rawPw);
      savedPwHash = pwHash;
      authPw.value = "";
      void conn.send({ t: "hello", pwHash } satisfies ToHost);
    } catch {
      authSubmit.disabled = false;
      authPw.disabled = false;
      authMsg.textContent = "Erro ao processar a senha no navegador.";
      authMsg.classList.add("error");
    }
  });

  const isPipSupported = (): boolean => {
    return Boolean(
      (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") ||
        (video as any).webkitSupportsPresentationMode,
    );
  };

  const togglePip = async (): Promise<void> => {
    if (!isPipSupported()) {
      showOsd("Janela flutuante não suportada");
      return;
    }
    if (video.readyState === 0 && !video.srcObject) {
      showOsd("Aguardando transmissão para abrir popout…");
      return;
    }
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        return;
      }
      if (document.pictureInPictureEnabled && typeof video.requestPictureInPicture === "function") {
        await video.requestPictureInPicture();
        return;
      }
      const webkitVideo = video as HTMLVideoElement & {
        webkitPresentationMode?: string;
        webkitSetPresentationMode?: (mode: string) => void;
      };
      if (typeof webkitVideo.webkitSetPresentationMode === "function") {
        const isPip = webkitVideo.webkitPresentationMode === "picture-in-picture";
        webkitVideo.webkitSetPresentationMode(isPip ? "inline" : "picture-in-picture");
      }
    } catch (err) {
      console.warn("Falha ao alternar Picture-in-Picture:", err);
      showOsd("Janela flutuante indisponível no momento");
    }
  };

  video.addEventListener("enterpictureinpicture", () => {
    pipBtn.textContent = "Voltar";
    pipBtn.classList.add("active");
    pipBtn.setAttribute("aria-pressed", "true");
    showOsd("🖼️ Janela flutuante ativada (Popout)");
  });

  video.addEventListener("leavepictureinpicture", () => {
    pipBtn.textContent = "Popout";
    pipBtn.classList.remove("active");
    pipBtn.setAttribute("aria-pressed", "false");
    showOsd("Janela flutuante fechada");
  });

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && !discordStatsModal.hidden) {
      e.preventDefault();
      discordStatsModal.hidden = true;
      showBarTemporarily();
      return;
    }
    if (finished || bar.hidden) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
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

    if (e.key === "Escape") {
      if (!discordStatsModal.hidden) {
        e.preventDefault();
        discordStatsModal.hidden = true;
        showBarTemporarily();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(1, Math.round((video.volume + 0.1) * 10) / 10);
      video.volume = next;
      vol.value = String(next);
      video.muted = false;
      syncSoundUi();
      showOsd(`🔊 Volume: ${Math.round(next * 100)}%`);
      showBarTemporarily();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(0, Math.round((video.volume - 0.1) * 10) / 10);
      video.volume = next;
      vol.value = String(next);
      if (next === 0) {
        video.muted = true;
      }
      syncSoundUi();
      showOsd(next === 0 ? "🔇 Silenciado" : `🔊 Volume: ${Math.round(next * 100)}%`);
      showBarTemporarily();
    }
  };

  window.addEventListener("keydown", onKeyDown);

  container.addEventListener("pointermove", showBarTemporarily);
  container.addEventListener("pointerdown", showBarTemporarily);
  container.addEventListener("touchstart", showBarTemporarily, { passive: true });
  bar.addEventListener("focusin", showBarTemporarily);

  soundBtn.addEventListener("click", () => {
    toggleMute();
    showBarTemporarily();
  });

  vol.addEventListener("input", () => {
    const v = Number(vol.value);
    video.volume = v;
    if (v === 0) {
      video.muted = true;
    } else if (video.muted) {
      video.muted = false;
      void video.play().catch(() => undefined);
    }
    syncSoundUi();
    showBarTemporarily();
  });

  copyDiagBtn.addEventListener("click", async () => {
    const diagData = {
      role: "viewer",
      timestamp: new Date().toISOString(),
      roomId: room,
      clientId,
      qualityPreset: currentPreset,
      chosenFps: currentFpsChoice,
      hostMaxFps: hostMaxFps,
      samplesCount: diagnosticBuffer.length,
      samples: diagnosticBuffer.getAll(),
    };
    (window as any).__pingLastDiag = diagData;
    void copyText(JSON.stringify(diagData, null, 2));
    const prev = copyDiagBtn.textContent;
    copyDiagBtn.textContent = "Copiado!";
    window.setTimeout(() => {
      copyDiagBtn.textContent = prev;
    }, 2000);
  });

  pipBtn.addEventListener("click", () => {
    void togglePip();
    showBarTemporarily();
  });

  closeStatsBtn.addEventListener("click", () => {
    discordStatsModal.hidden = true;
  });

  fsBtn.addEventListener("click", () => {
    toggleFullscreen();
    showBarTemporarily();
  });

  video.addEventListener("dblclick", () => toggleFullscreen());

  function onBeforeUnload(): void {
    if (finished) return;
    terminate("Conexão encerrada.", false);
    pingPlayer?.dispose();
  }

  window.addEventListener("beforeunload", onBeforeUnload);

  connectAttempt();
}
