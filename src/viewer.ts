import { Peer, type DataConnection, type MediaConnection } from "peerjs";
import {
  CONNECT_TIMEOUT_MS,
  hasTurn,
  peerOptions,
  ROOM_PATTERN,
} from "./config";
import {
  hashPassword,
  parseToViewer,
  type DeniedReason,
  type ToHost,
} from "./protocol";
import { StatsSampler, type ConnectionQuality } from "./stats";
import { $, shortId } from "./ui";

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
<main class="viewer" aria-label="Reprodutor da transmissão">
  <video id="v" autoplay playsinline muted></video>
  <div id="status" class="status" role="status" aria-live="polite">Conectando…</div>
  <div id="auth-wrap" class="status" hidden>
    <form id="auth-form" class="card auth-card">
      <h2>Sala protegida por senha</h2>
      <p id="auth-msg" class="muted">Digite a senha da sala para assistir.</p>
      <input id="auth-pw" type="password" placeholder="Senha" aria-label="Senha da sala" autocomplete="off" required />
      <button id="auth-submit" type="submit" class="primary">Entrar</button>
    </form>
  </div>
  <div class="bar bar-visible" id="bar" role="region" aria-label="Controles de reprodução" hidden>
    <button id="sound" type="button" title="Ativar ou silenciar som (M)">Ativar som</button>
    <input id="vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" />
    <span id="quality" class="quality" data-level="good" role="status" aria-label="Qualidade da conexão: Boa" title="Qualidade da conexão">Boa</span>
    <span id="stats" class="stats" aria-live="off"></span>
    <button id="fs" type="button" title="Alternar tela cheia (F)">Tela cheia</button>
  </div>
</main>
`;

export function mountViewer(root: HTMLElement, room: string): void {
  root.innerHTML = TEMPLATE;

  const video = $<HTMLVideoElement>(root, "#v");
  const statusEl = $<HTMLElement>(root, "#status");
  const authWrap = $<HTMLElement>(root, "#auth-wrap");
  const authForm = $<HTMLFormElement>(root, "#auth-form");
  const authMsg = $<HTMLElement>(root, "#auth-msg");
  const authPw = $<HTMLInputElement>(root, "#auth-pw");
  const authSubmit = $<HTMLButtonElement>(root, "#auth-submit");
  const bar = $<HTMLElement>(root, "#bar");
  const soundBtn = $<HTMLButtonElement>(root, "#sound");
  const vol = $<HTMLInputElement>(root, "#vol");
  const qualityEl = $<HTMLElement>(root, "#quality");
  const statsEl = $<HTMLElement>(root, "#stats");
  const fsBtn = $<HTMLButtonElement>(root, "#fs");
  const container = $<HTMLElement>(root, ".viewer");

  video.muted = true;
  video.defaultMuted = true;

  const syncSoundUi = (): void => {
    const isMuted = video.muted || video.volume === 0;
    soundBtn.textContent = isMuted ? "Ativar som" : "Silenciar";
  };

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
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", isError);
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
    if (backoffTimer !== undefined) {
      window.clearTimeout(backoffTimer);
      backoffTimer = undefined;
    }
    clearBarHideTimer();
    container.classList.remove("cursor-hidden");
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("keydown", onKeyDown);
    cleanupCurrentAttempt();
    bar.hidden = true;
    video.srcObject = null;
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

  const connectAttempt = (): void => {
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

    const p = new Peer(peerOptions());
    peer = p;

    attemptTimeout = window.setTimeout(() => {
      if (peer !== p || gotStream || finished) return;
      const reason: FailureReason = p.open ? "ice" : "signaling";
      scheduleReconnect(reason);
    }, CONNECT_TIMEOUT_MS);

    p.on("open", () => {
      if (peer !== p || finished) return;
      setStatus(
        reconnectAttempt > 0
          ? `Reconectando à sala (tentativa ${reconnectAttempt} de ${MAX_RECONNECT_ATTEMPTS})…`
          : "Procurando a sala…",
      );

      const c = p.connect(room, {
        reliable: true,
        serialization: "json",
        metadata: { clientId },
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
        const helloMsg: ToHost = savedPwHash
          ? { t: "hello", pwHash: savedPwHash }
          : { t: "hello" };
        void c.send(helloMsg);
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
        if (video.srcObject !== remote) {
          video.srcObject = remote;
          syncSoundUi();
        }
        void video.play().catch(() => {
          video.muted = true;
          syncSoundUi();
          void video.play().catch(() => undefined);
        });
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
        showBarTemporarily();

        if (statsTimer === undefined) {
          const sampler = new StatsSampler(call.peerConnection);
          statsTimer = window.setInterval(async () => {
            if (peer !== p || finished) return;
            const s = await sampler.sample();
            if (!s) return;
            const ping = s.rttMs === null ? "" : ` · ${Math.round(s.rttMs)} ms`;
            statsEl.textContent = `${s.width}×${s.height} · ${s.fps} fps · ${(s.kbps / 1000).toFixed(1)} Mbps${ping}`;
            const qLabel = formatQualityLabel(s.quality);
            qualityEl.dataset.level = s.quality;
            qualityEl.textContent = qLabel;
            qualityEl.setAttribute(
              "aria-label",
              `Qualidade da conexão: ${qLabel}`,
            );
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

  const onKeyDown = (e: KeyboardEvent): void => {
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

    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      toggleMute();
      showBarTemporarily();
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      toggleFullscreen();
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

  fsBtn.addEventListener("click", () => {
    toggleFullscreen();
    showBarTemporarily();
  });

  video.addEventListener("dblclick", () => toggleFullscreen());

  window.addEventListener("beforeunload", () => {
    if (finished) return;
    terminate("Conexão encerrada.", false);
  });

  connectAttempt();
}
