import { Peer, type DataConnection, type MediaConnection } from "peerjs";
import { CONNECT_TIMEOUT_MS, hasTurn, peerOptions, ROOM_PREFIX, fetchIceServers } from "./config";
import {
  applyCodecPreferences,
  BitrateAdapter,
  capVideoSender,
  captureScreen,
  CODEC_PRESETS,
  preferVideoCodecsInSdp,
  setContentHint,
  type BitrateAdapterMode,
  type CaptureOptions,
  type CodecPreset,
  type ContentHint,
} from "./media";
import {
  hashPassword,
  parseConnectionMetadata,
  parseToHost,
  type QualityPreset,
  type ToViewer,
} from "./protocol";
import {
  CircularBuffer,
  SenderStatsSampler,
  type HostDiagnosticSample,
  type QualityLimitationReason,
  type SenderStatsSample,
} from "./stats";
import { $, copyText, shortId, toast } from "./ui";
import { startHostLifecycle, type HostLifecycleHandle } from "./app/services/supabase";
import type { Room } from "./app/services/rooms";
import { ChatHub } from "./chat/chat-hub";
import { ChatUi } from "./chat/chat-ui";
import { getProfile } from "./app/identity";
import {
  resolveTransportMode,
  createHostTransport,
  type HostTransport,
  type TransportInfo,
} from "./transport";

const STORAGE_UPLOAD_KEY = "ping_upload_mbps";
const DEFAULT_UPLOAD_MBPS = 50;
const DEFAULT_MAX_VIEWERS = 3;
const MAX_PW_ATTEMPTS = 3;
const PW_FAILURE_DELAY_MS = 1200;

let joinAudioCtx: AudioContext | null = null;

/**
 * Toca um aviso sonoro (chime) suave no anfitrião quando um novo espectador entra.
 * Usa Web Audio API nativo — sem arquivos externos e em total conformidade com CSP.
 */
export function playJoinChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!joinAudioCtx || joinAudioCtx.state === "closed") {
      joinAudioCtx = new AudioCtx();
    }
    if (joinAudioCtx.state === "suspended") {
      void joinAudioCtx.resume();
    }

    const ctx = joinAudioCtx;
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + dur);
    };

    // Acorde em dois tons estilo Discord (D5 587.33Hz -> A5 880.00Hz)
    playTone(587.33, now, 0.18);
    playTone(880.0, now + 0.12, 0.28);
  } catch {
    // Silencia qualquer restrição de autoplay
  }
}

interface ViewerEntry {
  conn: DataConnection;
  call?: MediaConnection;
  pc?: RTCPeerConnection;
  mode?: "p2p" | "sfu";
  clientId?: string;
  sampler: SenderStatsSampler | null;
  adapter: BitrateAdapter;
  lastStats: SenderStatsSample | null;
  diagnosticBuffer: CircularBuffer<HostDiagnosticSample>;
  qualityPreset?: QualityPreset;
  customFps?: number;
  cleanup: () => void;
}

interface PendingViewerEntry {
  conn: DataConnection;
  clientId?: string;
  approve: () => void;
  reject: () => void;
  block: () => void;
  cleanup: () => void;
}

function readStoredUploadMbps(): number {
  try {
    const raw = localStorage.getItem(STORAGE_UPLOAD_KEY);
    if (!raw) return DEFAULT_UPLOAD_MBPS;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_UPLOAD_MBPS;
  } catch {
    return DEFAULT_UPLOAD_MBPS;
  }
}

function writeStoredUploadMbps(val: number): void {
  try {
    localStorage.setItem(STORAGE_UPLOAD_KEY, String(val));
  } catch {
    // Ignora caso localStorage esteja bloqueado
  }
}

function formatLimitation(reason: QualityLimitationReason | undefined): string {
  switch (reason) {
    case "bandwidth":
      return "Banda";
    case "cpu":
      return "CPU (alta)";
    case "other":
      return "Outro";
    case "none":
      return "Nenhuma";
    default:
      return "—";
  }
}

const TEMPLATE = `
<main class="shell ping-host-studio studio">
  <header class="studio-header brand">
    <div class="studio-room-info">
      <span class="dot" aria-hidden="true"></span>
      <span class="studio-brand-title">PING STUDIO</span>
      <span class="studio-badge-config" id="header-config-badge">Configuração</span>
      <span class="live-badge header-live-pill" id="header-live-badge" hidden>
        <span class="pulse-dot"></span> AO VIVO
      </span>
      <h1 class="studio-heading-title" id="studio-heading-title">Configure sua transmissão</h1>
    </div>
    <div class="studio-header-actions">
      <span class="viewer-counter muted" id="header-viewer-count" hidden>0 espectadores</span>
      <a href="/" class="host-back-link">← Voltar às salas</a>
    </div>
  </header>

  <!-- EXPERIÊNCIA 1: CONFIGURAÇÃO DE TRANSMISSÃO -->
  <section class="card setup-card-container" id="setup">
    <div class="setup-header">
      <h2>Configure sua transmissão</h2>
      <p class="muted">Defina a qualidade, o áudio e quem poderá assistir.</p>
    </div>

    <div class="setup-layout-grid">
      <!-- Coluna Principal: Formulário Temático -->
      <div class="setup-main-col">
        <div class="setup-cards-grid">
          <!-- Card 1: Qualidade -->
          <div class="setup-card" data-card="quality">
            <div class="setup-card__head">
              <div class="setup-card__icon-wrap">
                <svg class="setup-card__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                  <line x1="8" y1="21" x2="16" y2="21"></line>
                  <line x1="12" y1="17" x2="12" y2="21"></line>
                </svg>
              </div>
              <div class="setup-card__titles">
                <h3>Qualidade</h3>
                <p>FPS, resolução e bitrate.</p>
              </div>
            </div>
            <div class="setup-card__body grid">
              <label for="fps">Taxa de quadros
                <select id="fps">
                  <option value="30">30 FPS</option>
                  <option value="60" selected>60 FPS (Padrão)</option>
                  <option value="120">120 FPS (Ultra Gamer)</option>
                  <option value="144">144 FPS (Competitivo)</option>
                  <option value="240">240 FPS (Extremo)</option>
                </select>
              </label>
              <label for="res">Resolução
                <select id="res">
                  <option value="720">720p</option>
                  <option value="1080" selected>1080p</option>
                  <option value="1440">1440p</option>
                  <option value="2160">4K</option>
                </select>
              </label>
              <label for="br">Bitrate máx. por espectador
                <select id="br">
                  <option value="4000">4 Mbps</option>
                  <option value="8000" selected>8 Mbps</option>
                  <option value="12000">12 Mbps</option>
                  <option value="20000">20 Mbps</option>
                </select>
              </label>
              <label for="hint">Tipo de conteúdo
                <select id="hint">
                  <option value="motion" selected>Jogo / vídeo (prioriza fluidez)</option>
                  <option value="detail">Texto / slides (prioriza nitidez)</option>
                </select>
              </label>
            </div>
          </div>

          <!-- Card 2: Acesso -->
          <div class="setup-card" data-card="access">
            <div class="setup-card__head">
              <div class="setup-card__icon-wrap">
                <svg class="setup-card__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </div>
              <div class="setup-card__titles">
                <h3>Acesso</h3>
                <p>Senha e aprovação.</p>
              </div>
            </div>
            <div class="setup-card__body">
              <label for="room-password">Senha da sala (opcional)
                <input type="password" id="room-password" placeholder="Em branco = sem senha" autocomplete="off" />
              </label>
              <label class="check advanced-check">
                <input type="checkbox" id="require-approval" />
                <span>Exigir aprovação manual para cada espectador</span>
              </label>
            </div>
          </div>

          <!-- Card 3: Áudio -->
          <div class="setup-card" data-card="audio">
            <div class="setup-card__head">
              <div class="setup-card__icon-wrap">
                <svg class="setup-card__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
              </div>
              <div class="setup-card__titles">
                <h3>Áudio</h3>
                <p>Captura do sistema ou aba.</p>
              </div>
            </div>
            <div class="setup-card__body">
              <label class="check">
                <input type="checkbox" id="audio" checked />
                <span>Capturar áudio do sistema ou da aba</span>
              </label>
              <p class="field-help-text muted">Transmita o som do seu jogo, Discord ou computador diretamente para os espectadores.</p>
            </div>
          </div>

          <!-- Card 4: Espectadores -->
          <div class="setup-card" data-card="viewers">
            <div class="setup-card__head">
              <div class="setup-card__icon-wrap">
                <svg class="setup-card__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                  <circle cx="9" cy="7" r="4"></circle>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
              </div>
              <div class="setup-card__titles">
                <h3>Espectadores</h3>
                <p>Limite e permissões.</p>
              </div>
            </div>
            <div class="setup-card__body">
              <label for="max-viewers">Máximo de pessoas simultâneas
                <select id="max-viewers">
                  <option value="1">1 pessoa (Mais leve para sua internet)</option>
                  <option value="2">2 pessoas</option>
                  <option value="3" selected>3 pessoas (Padrão recomendado)</option>
                  <option value="4">4 pessoas</option>
                  <option value="5">5 pessoas</option>
                  <option value="6">6 pessoas</option>
                  <option value="7">7 pessoas</option>
                  <option value="8">8 pessoas (Exige internet rápida)</option>
                  <option value="10">10 pessoas (Exige fibra potente)</option>
                  <option value="12">12 pessoas (Fibra de alta velocidade)</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <!-- Seção de opções avançadas (acordeão fechado inicialmente) -->
        <details class="advanced ping-details" id="advanced">
          <summary class="ping-summary">Opções avançadas de vídeo, rede e acesso</summary>
          <div class="grid advanced-grid">
            <label for="codec">Preferência de codec
              <select id="codec">
                <option value="h264" selected>H.264 → VP9 → AV1 → VP8 (Hardware acelerado - Recomendado)</option>
                <option value="vp9">VP9 → AV1 → H.264 → VP8 (Alta compressão)</option>
                <option value="av1">AV1 → VP9 → H.264 → VP8</option>
                <option value="vp8">VP8 → H.264 → VP9 → AV1 (Compatibilidade)</option>
              </select>
            </label>
            <label for="bitrate-mode">Controle de bitrate
              <select id="bitrate-mode">
                <option value="fixed" selected>Fixo (mantém teto configurado - recomendado)</option>
                <option value="adaptive">Adaptativo (reduz teto apenas sob perda real)</option>
              </select>
            </label>
            <label for="upload-mbps">Meu upload em Mbps
              <input type="number" id="upload-mbps" min="1" max="10000" step="1" value="50" />
            </label>
          </div>
        </details>

        <!-- Status de conexão e dicas em blocos compactos -->
        <div class="turn-hint ${hasTurn() ? "turn-ready" : "turn-missing"}" role="status">
          ${hasTurn()
            ? '<span>🛡️ <strong>TURN ativo:</strong> Conexões externas e redes móveis (4G/5G) habilitadas.</span>'
            : '<span>⚠️ <strong>Aviso de Rede:</strong> TURN não configurado. Funciona na mesma rede/Wi-Fi. Conexões em 4G/5G ou CGNAT exigem servidor TURN.</span>'}
        </div>
        <details class="setup-help-tip">
          <summary class="muted">💡 <strong>Dica contra tela preta:</strong> clique para ver detalhes</summary>
          <p class="muted screen-share-tip">Para transmitir jogos, Discord, Spotify ou navegadores sem tela preta, compartilhe <strong>Tela inteira</strong> ou desative a aceleração de hardware no app compartilhado.</p>
        </details>
        <div id="p2p-human-warning" class="p2p-human-tip" role="status"></div>
        <p class="warn" id="setup-capacity-warn" role="status" hidden></p>
        <p class="warn" id="unsupported" hidden>Este navegador não consegue compartilhar a tela. Use Chrome, Edge ou Firefox no computador. Quem só assiste pode usar qualquer navegador.</p>
      </div>

      <!-- Coluna Secundária: Resumo e Início -->
      <aside class="setup-summary-col">
        <div class="summary-card">
          <div class="summary-card__header">
            <h3>Resumo da transmissão</h3>
          </div>
          <div class="summary-card__list">
            <div class="summary-item">
              <span class="summary-label">Resolução</span>
              <strong class="summary-value" id="sum-res">1080p</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Quadros</span>
              <strong class="summary-value" id="sum-fps">60 FPS</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Bitrate máximo</span>
              <strong class="summary-value" id="sum-br">8 Mbps</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Conteúdo</span>
              <strong class="summary-value" id="sum-hint">Jogo / Vídeo</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Espectadores</span>
              <strong class="summary-value" id="sum-viewers">3 pessoas</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Áudio</span>
              <strong class="summary-value" id="sum-audio">Ativado</strong>
            </div>
            <div class="summary-item">
              <span class="summary-label">Acesso</span>
              <strong class="summary-value" id="sum-access">Público</strong>
            </div>
          </div>
          <button id="start" type="button" class="primary btn-start-broadcast">
            <span class="live-pulse-text">((•))</span> INICIAR TRANSMISSÃO
          </button>
        </div>
      </aside>
    </div>
  </section>

  <!-- EXPERIÊNCIA 2: STUDIO DO ORGANIZADOR -->
  <section class="card studio-live-container" id="live" hidden>
    <div class="studio-main-grid" id="host-palco">
      <!-- Linha Superior: Stage de Vídeo (Esquerda) + Chat ao Vivo (Direita) -->
      <div class="studio-top-row palco-layout palco-layout-host">
        <div class="studio-stage-column palco-stage">
          <!-- Palco do Vídeo / Prévia -->
          <div class="stream-stage preview-wrap">
            <video id="preview" muted autoplay playsinline aria-label="Pré-visualização da tela capturada" class="stream-stage__video"></video>
            <div class="discord-live-pill stream-stage__overlay"><span class="pulse-dot"></span> AO VIVO</div>
            <div class="stream-stage__placeholder" id="preview-placeholder">
              <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2" class="stream-stage__placeholder-icon">
                <rect x="2" y="3" width="20" height="14" rx="2"></rect>
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor"></polygon>
              </svg>
              <span class="stream-stage__placeholder-text">PRÉVIA DA TRANSMISSÃO</span>
            </div>
            <div id="host-paused-overlay" class="paused-overlay" hidden>
              <span>⏸️ Transmissão Pausada</span>
            </div>
            <div id="host-stopped-overlay" class="stopped-overlay" hidden>
              <div class="stopped-box">
                <p class="stopped-title">⏹️ Transmissão Parada</p>
                <p class="muted stopped-desc">A sala continua aberta com o mesmo link para os seus amigos!</p>
                <button id="btn-resume-live" type="button" class="primary sm resume-live-btn">▶️ Iniciar Transmissão</button>
              </div>
            </div>
          </div>

          <!-- Resumo de Métricas (Pills) -->
          <div class="diagnostic-summary live-meta">
            <span id="count" class="metric-pill metric-pill--online" role="status" aria-live="polite">0 espectadores</span>
            <span id="metric-fps" class="metric-pill">60 FPS</span>
            <span id="metric-bitrate" class="metric-pill">8,0 Mbps</span>
            <span id="metric-rtt" class="metric-pill">1 ms RTT</span>
            <span id="capacity-info" class="metric-pill muted"></span>
          </div>
          <p class="warn" id="capacity-warn" role="status" hidden></p>
        </div>

        <!-- Coluna do Chat ao Vivo -->
        <aside class="studio-chat palco-chat-col" id="host-chat-mount"></aside>
      </div>

      <!-- Linha Compartilhar Link -->
      <div class="share-url row">
        <input id="link" readonly aria-label="Link da sala" />
        <button id="copy" type="button" class="primary">Copiar link</button>
      </div>

      <!-- Card de Controles da Transmissão (2x2 Grid) -->
      <div class="studio-controls">
        <div class="studio-controls__header">
          <h3>Controles da transmissão</h3>
        </div>
        <div class="control-group">
          <span class="control-label">TRANSMISSÃO</span>
          <div class="control-actions live-toolbar">
            <button id="change-source" type="button" class="btn-discord-tool" title="Trocar janela ou tela compartilhada">🖥️ Trocar Tela</button>
            <button id="pause-stream" type="button" class="btn-discord-tool" title="Pausar ou retomar vídeo da transmissão">⏸️ Pausar Tela</button>
            <button id="mute-audio" type="button" class="btn-discord-tool" title="Silenciar ou ativar áudio da transmissão">🔊 Áudio Ativo</button>
            <button id="btn-toggle-visibility" type="button" class="btn-discord-tool" title="Alternar visibilidade no lobby">👁️ Visibilidade</button>
          </div>
        </div>

        <div class="control-group">
          <span class="control-label">ACESSO À SALA</span>
          <div class="control-actions live-room-settings">
            <button id="stop-stream" type="button" class="btn-discord-pill" title="Parar transmissão da live mantendo a sala e o link abertos">⏹️ Parar Live</button>
            <button id="btn-change-password" type="button" class="btn-discord-pill" title="Alterar ou definir a senha desta sala">🔑 Alterar Senha</button>
            <button id="btn-remove-password" type="button" class="btn-discord-pill" title="Remover a senha e deixar a sala aberta para todos">🔓 Tirar Senha</button>
          </div>
        </div>

        <div class="studio-danger-zone">
          <button id="stop" type="button" class="danger">Encerrar transmissão</button>
        </div>
      </div>

      <!-- Seção Expansível: Espectadores e Diagnóstico -->
      <details class="studio-diagnostics" id="diag-accordion" open>
        <summary class="studio-diagnostics__summary">
          <div class="diag-header-text">
            <h3>Gerenciamento de espectadores</h3>
            <p class="muted">Lista, codec, bitrate, FPS, RTT e ações administrativas em painel expansível.</p>
          </div>
          <div class="diag-summary-right">
            <button id="copy-diag" type="button" class="btn-discord-pill sm" title="Copiar diagnóstico técnico em JSON">Copiar diagnóstico (JSON)</button>
            <span class="badge-connected" id="diag-viewer-badge">0 conectados</span>
          </div>
        </summary>
        <div class="diagnostic-details">
          <div id="pending-wrap" class="pending-wrap" role="region" aria-label="Solicitações de entrada pendentes" hidden>
            <p class="pending-title">Aguardando aprovação</p>
            <div id="pending-list" class="pending-list"></div>
          </div>
          <div id="stats-wrap" class="stats-wrap" hidden>
            <table class="stats-table" aria-label="Estatísticas por espectador">
              <thead>
                <tr>
                  <th>Espectador</th>
                  <th>Codec</th>
                  <th>Bitrate</th>
                  <th>FPS</th>
                  <th>RTT</th>
                  <th>Limitação</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="stats-body"></tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  </section>
</main>
`;

function getPresetParameters(
  preset: QualityPreset | undefined,
  baseMaxKbps: number,
  baseFps: number,
  customFps?: number,
): { kbps: number; fps: number; scaleDown: number } {
  let targetFps = baseFps;
  if (typeof customFps === "number" && customFps > 0) {
    targetFps = Math.min(customFps, baseFps);
  }

  switch (preset) {
    case "720p":
      return {
        kbps: Math.min(baseMaxKbps, 2500),
        fps: Math.min(targetFps, 60),
        scaleDown: 1.5,
      };
    case "480p":
      return {
        kbps: Math.min(baseMaxKbps, 1200),
        fps: Math.min(targetFps, 30),
        scaleDown: 2.25,
      };
    case "360p":
      return {
        kbps: Math.min(baseMaxKbps, 600),
        fps: Math.min(targetFps, 30),
        scaleDown: 3,
      };
    case "source":
    default:
      return {
        kbps: baseMaxKbps,
        fps: targetFps,
        scaleDown: 1,
      };
  }
}

export function mountHost(root: HTMLElement, mountOpts: { password?: string; roomId?: string; hostToken?: string; hidden?: boolean; onExit?: () => void } = {}): void {
  document.title = "Ping — Compartilhar Tela";
  root.innerHTML = TEMPLATE;

  const setup = $<HTMLElement>(root, "#setup");
  const live = $<HTMLElement>(root, "#live");
  const startBtn = $<HTMLButtonElement>(root, "#start");
  const stopBtn = $<HTMLButtonElement>(root, "#stop");
  const copyBtn = $<HTMLButtonElement>(root, "#copy");
  const preview = $<HTMLVideoElement>(root, "#preview");
  const previewPlaceholder = root.querySelector<HTMLElement>("#preview-placeholder");
  const linkInput = $<HTMLInputElement>(root, "#link");
  const countEl = $<HTMLElement>(root, "#count");
  const capacityInfoEl = $<HTMLElement>(root, "#capacity-info");
  const capacityWarnEl = $<HTMLElement>(root, "#capacity-warn");
  const setupCapacityWarnEl = $<HTMLElement>(root, "#setup-capacity-warn");
  const pendingWrap = $<HTMLElement>(root, "#pending-wrap");
  const pendingList = $<HTMLElement>(root, "#pending-list");
  const statsWrap = $<HTMLElement>(root, "#stats-wrap");
  const statsBody = $<HTMLElement>(root, "#stats-body");
  const uploadInput = $<HTMLInputElement>(root, "#upload-mbps");
  const maxViewersInput = $<HTMLSelectElement | HTMLInputElement>(root, "#max-viewers");
  const p2pHumanWarnEl = root.querySelector<HTMLElement>("#p2p-human-warning");
  const passwordInput = $<HTMLInputElement>(root, "#room-password");
  const requireApprovalInput = $<HTMLInputElement>(root, "#require-approval");
  const brSelect = $<HTMLSelectElement>(root, "#br");
  const unsupported = $<HTMLElement>(root, "#unsupported");
  const changeSourceBtn = $<HTMLButtonElement>(root, "#change-source");
  const pauseStreamBtn = $<HTMLButtonElement>(root, "#pause-stream");
  const stopStreamBtn = $<HTMLButtonElement>(root, "#stop-stream");
  const muteAudioBtn = $<HTMLButtonElement>(root, "#mute-audio");
  const hostPausedOverlay = $<HTMLElement>(root, "#host-paused-overlay");
  const hostStoppedOverlay = $<HTMLElement>(root, "#host-stopped-overlay");
  const resumeLiveBtn = $<HTMLButtonElement>(root, "#btn-resume-live");
  const toggleVisibilityBtn = $<HTMLButtonElement>(root, "#btn-toggle-visibility");
  const changePasswordBtn = $<HTMLButtonElement>(root, "#btn-change-password");
  const removePasswordBtn = $<HTMLButtonElement>(root, "#btn-remove-password");
  const hostBackLink = root.querySelector<HTMLAnchorElement>(".host-back-link");
  const fpsSelect = $<HTMLSelectElement>(root, "#fps");
  const resSelect = $<HTMLSelectElement>(root, "#res");
  const hintSelect = $<HTMLSelectElement>(root, "#hint");
  const audioInput = $<HTMLInputElement>(root, "#audio");
  const metricFps = root.querySelector<HTMLElement>("#metric-fps");
  const metricBitrate = root.querySelector<HTMLElement>("#metric-bitrate");
  const metricRtt = root.querySelector<HTMLElement>("#metric-rtt");
  const diagViewerBadge = root.querySelector<HTMLElement>("#diag-viewer-badge");
  const headerLiveBadge = root.querySelector<HTMLElement>("#header-live-badge");
  const headerConfigBadge = root.querySelector<HTMLElement>("#header-config-badge");
  const headerViewerCount = root.querySelector<HTMLElement>("#header-viewer-count");
  const studioHeadingTitle = root.querySelector<HTMLElement>("#studio-heading-title");

  const sumRes = root.querySelector<HTMLElement>("#sum-res");
  const sumFps = root.querySelector<HTMLElement>("#sum-fps");
  const sumBr = root.querySelector<HTMLElement>("#sum-br");
  const sumHint = root.querySelector<HTMLElement>("#sum-hint");
  const sumViewers = root.querySelector<HTMLElement>("#sum-viewers");
  const sumAudio = root.querySelector<HTMLElement>("#sum-audio");
  const sumAccess = root.querySelector<HTMLElement>("#sum-access");

  const updateSetupSummary = (): void => {
    if (sumRes) sumRes.textContent = `${resSelect.value}p`;
    if (sumFps) sumFps.textContent = `${fpsSelect.value} FPS`;
    if (sumBr) sumBr.textContent = `${Number(brSelect.value) / 1000} Mbps`;
    if (sumHint) sumHint.textContent = hintSelect.value === "motion" ? "Jogo / Vídeo" : "Texto / Detalhes";
    if (sumViewers) sumViewers.textContent = `${maxViewersInput.value} ${Number(maxViewersInput.value) === 1 ? "pessoa" : "pessoas"}`;
    if (sumAudio) sumAudio.textContent = audioInput.checked ? "Ativado" : "Desativado";
    if (sumAccess) sumAccess.textContent = passwordInput.value ? "Protegido por senha" : "Público";
  };

  fpsSelect.addEventListener("change", updateSetupSummary);
  resSelect.addEventListener("change", updateSetupSummary);
  brSelect.addEventListener("change", updateSetupSummary);
  hintSelect.addEventListener("change", updateSetupSummary);
  maxViewersInput.addEventListener("change", updateSetupSummary);
  audioInput.addEventListener("change", updateSetupSummary);
  passwordInput.addEventListener("input", updateSetupSummary);
  updateSetupSummary();

  let isStreamPaused = false;
  let isAudioMuted = false;
  let isLiveActive = true;
  let isRoomHidden = Boolean(mountOpts.hidden);
  let currentPassword = mountOpts.password || passwordInput.value || "";
  let expectedPwHash: string | null = null;

  uploadInput.value = String(readStoredUploadMbps());
  if (mountOpts.password) {
    passwordInput.value = mountOpts.password;
    $<HTMLDetailsElement>(root, "#advanced").open = true;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    unsupported.hidden = false;
    startBtn.disabled = true;
  }

  let peer: Peer | null = null;
  let hostLifecycle: HostLifecycleHandle | null = null;
  let stream: MediaStream | null = null;
  let currentVideoTrack: MediaStreamTrack | null = null;
  let startTimeout: number | undefined;
  let statsInterval: number | undefined;
  let activeBitrateKbps = Number(brSelect.value);
  const viewers = new Map<string, ViewerEntry>();
  const requestedPresets = new Map<string, QualityPreset>();
  const requestedFps = new Map<string, number>();
  const pendingViewers = new Map<string, PendingViewerEntry>();
  const approvedClients = new Set<string>();
  const blockedIds = new Set<string>();
  const failedPasswordAttempts = new Map<string, number>();
  let hostTransport: HostTransport | null = null;
  let currentTransportInfo: TransportInfo = { mode: "p2p" };

  const clearStartTimeout = (): void => {
    if (startTimeout !== undefined) {
      window.clearTimeout(startTimeout);
      startTimeout = undefined;
    }
  };

  const clearStatsInterval = (): void => {
    if (statsInterval !== undefined) {
      window.clearInterval(statsInterval);
      statsInterval = undefined;
    }
  };

  const getUploadLimitMbps = (): number => {
    const val = Number(uploadInput.value);
    return Number.isFinite(val) && val > 0 ? val : DEFAULT_UPLOAD_MBPS;
  };

  const updateCapacityUi = (): void => {
    const limitMbps = getUploadLimitMbps();
    const selectedBrMbps = Number(brSelect.value) / 1000;

    if (selectedBrMbps > limitMbps) {
      setupCapacityWarnEl.hidden = false;
      setupCapacityWarnEl.textContent = `Aviso: 1 espectador a ${selectedBrMbps.toFixed(0)} Mbps já ultrapassa seu upload informado de ${limitMbps} Mbps.`;
    } else {
      setupCapacityWarnEl.hidden = true;
    }

    const maxV = Number(maxViewersInput.value) || DEFAULT_MAX_VIEWERS;
    if (p2pHumanWarnEl) {
      p2pHumanWarnEl.replaceChildren();
      const strong = document.createElement("strong");
      const desc = document.createElement("span");

      if (maxV <= 3) {
        p2pHumanWarnEl.className = "p2p-human-tip";
        strong.textContent = "👥 Como funciona a transmissão: ";
        desc.textContent = `O vídeo sai direto do seu computador para cada amigo. O padrão de ${maxV} pessoas é super leve e roda com tranquilidade na grande maioria das conexões de internet de casa.`;
      } else if (maxV <= 5) {
        p2pHumanWarnEl.className = "p2p-human-tip is-warning";
        strong.textContent = `⚠️ Atenção ao número de amigos (${maxV} pessoas): `;
        desc.textContent = `Como o vídeo sai direto do seu computador, cada amigo conectado consome um pedaço do seu upload de internet. Se sua conexão oscilar ou alguém na sua casa estiver baixando arquivos pesados, a transmissão pode começar a dar pequenos engasgos para eles. Recomendamos uma boa internet de fibra ótica.`;
      } else {
        p2pHumanWarnEl.className = "p2p-human-tip is-danger";
        strong.textContent = `🚨 Muitas pessoas na sala (${maxV} pessoas): `;
        desc.textContent = `Transmitir para tanta gente direto do seu computador exige uma internet de fibra rápida e muito estável. Com muitas pessoas conectadas, sua internet de casa pode ficar sobrecarregada e os espectadores podem ver a tela travando. Se isso acontecer, diminua a quantidade de vagas ou reduza a qualidade do vídeo nas opções acima.`;
      }

      p2pHumanWarnEl.appendChild(strong);
      p2pHumanWarnEl.appendChild(desc);
    }

    const n = viewers.size;
    const perViewerMbps = activeBitrateKbps / 1000;
    const requiredMbps = n * perViewerMbps;

    capacityInfoEl.textContent = `· Upload estimado: ${requiredMbps.toFixed(1)} / ${limitMbps} Mbps`;

    if (n > 0 && requiredMbps > limitMbps) {
      capacityWarnEl.hidden = false;
      capacityWarnEl.textContent = `Capacidade de upload excedida: ${n} espectador(es) × ${perViewerMbps.toFixed(0)} Mbps = ${requiredMbps.toFixed(1)} Mbps necessários (limite informado: ${limitMbps} Mbps).`;
    } else {
      capacityWarnEl.hidden = true;
    }
  };

  const renderPendingList = (): void => {
    if (pendingViewers.size === 0) {
      pendingWrap.hidden = true;
      pendingList.replaceChildren();
      return;
    }

    pendingWrap.hidden = false;
    const items: HTMLElement[] = [];

    for (const [peerId, entry] of pendingViewers.entries()) {
      const row = document.createElement("div");
      row.className = "pending-row";

      const label = document.createElement("span");
      label.textContent = `Espectador #${peerId.slice(-6)}`;

      const actions = document.createElement("div");
      actions.className = "row";

      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.className = "primary sm approve-btn";
      approveBtn.textContent = "Aceitar";
      approveBtn.addEventListener("click", entry.approve);

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "sm reject-btn";
      rejectBtn.textContent = "Recusar";
      rejectBtn.addEventListener("click", entry.reject);

      const blockBtn = document.createElement("button");
      blockBtn.type = "button";
      blockBtn.className = "danger sm block-btn";
      blockBtn.textContent = "Bloquear";
      blockBtn.addEventListener("click", entry.block);

      actions.append(approveBtn, rejectBtn, blockBtn);
      row.append(label, actions);
      items.push(row);
    }

    pendingList.replaceChildren(...items);
  };

  const switchToP2P = async (): Promise<void> => {
    if (!hostTransport || hostTransport.mode !== "sfu") return;
    await hostTransport.stop().catch(() => {});
    hostTransport = null;
    currentTransportInfo = { mode: "p2p" };

    for (const { conn } of viewers.values()) {
      send(conn, { t: "transport-switch", mode: "p2p" });
    }

    if (stream && peer) {
      for (const [peerId, entry] of viewers.entries()) {
        entry.mode = "p2p";
        if (!entry.call && entry.conn.open) {
          const call = peer.call(peerId, stream, {
            metadata: { room: mountOpts.roomId || "" },
          });
          if (call) {
            entry.call = call;
            entry.pc = call.peerConnection;
          }
        }
      }
    }
  };

  const rekeySfuSession = async (): Promise<void> => {
    if (!hostTransport || hostTransport.mode !== "sfu" || !stream) return;
    try {
      currentTransportInfo = await hostTransport.start(stream);
      for (const entry of viewers.values()) {
        send(entry.conn, { t: "approved", transport: currentTransportInfo });
      }
    } catch {
      // Se falhar a republicação no SFU, degrada para P2P
      void switchToP2P();
    }
  };

  const kickViewer = (peerId: string): void => {
    const entry = viewers.get(peerId);
    if (!entry) return;
    if (entry.clientId) approvedClients.delete(entry.clientId);
    approvedClients.delete(peerId);
    send(entry.conn, { t: "kicked" });
    dropViewer(peerId);
    if (hostTransport && hostTransport.mode === "sfu") {
      void rekeySfuSession();
    }
  };

  const blockViewer = (peerId: string): void => {
    const entry = viewers.get(peerId);
    blockedIds.add(peerId);
    if (entry?.clientId) {
      blockedIds.add(entry.clientId);
      approvedClients.delete(entry.clientId);
    }
    approvedClients.delete(peerId);
    if (entry) {
      send(entry.conn, { t: "denied", reason: "blocked" });
      dropViewer(peerId);
    }
    if (hostTransport && hostTransport.mode === "sfu") {
      void rekeySfuSession();
    }
  };

  const renderStatsTable = (): void => {
    if (diagViewerBadge) {
      diagViewerBadge.textContent = `${viewers.size} ${viewers.size === 1 ? "conectado" : "conectados"}`;
    }
    if (headerViewerCount) {
      headerViewerCount.textContent = `${viewers.size} ${viewers.size === 1 ? "espectador" : "espectadores"}`;
    }

    if (viewers.size === 0) {
      statsWrap.hidden = true;
      statsBody.replaceChildren();
      if (metricFps) metricFps.textContent = `${fpsSelect.value} FPS`;
      if (metricBitrate) metricBitrate.textContent = `${(activeBitrateKbps / 1000).toFixed(1).replace(".", ",")} Mbps`;
      if (metricRtt) metricRtt.textContent = `— ms RTT`;
      return;
    }

    statsWrap.hidden = false;

    // Remove linhas de espectadores que já saíram
    for (const tr of [...statsBody.querySelectorAll<HTMLTableRowElement>("tr")]) {
      const rowPeer = tr.dataset.peer;
      if (!rowPeer || !viewers.has(rowPeer)) {
        tr.remove();
      }
    }

    for (const [peerId, entry] of viewers.entries()) {
      let tr = statsBody.querySelector<HTMLTableRowElement>(
        `tr[data-peer="${CSS.escape(peerId)}"]`,
      );
      if (!tr) {
        tr = document.createElement("tr");
        tr.dataset.peer = peerId;

        for (let i = 0; i < 6; i++) {
          tr.appendChild(document.createElement("td"));
        }

        const tdActions = document.createElement("td");
        tdActions.className = "actions-cell";

        const kickBtn = document.createElement("button");
        kickBtn.type = "button";
        kickBtn.className = "sm kick-btn";
        kickBtn.textContent = "Remover";
        kickBtn.addEventListener("click", () => kickViewer(peerId));

        const blockBtn = document.createElement("button");
        blockBtn.type = "button";
        blockBtn.className = "danger sm block-btn";
        blockBtn.textContent = "Bloquear";
        blockBtn.addEventListener("click", () => blockViewer(peerId));

        tdActions.append(kickBtn, blockBtn);
        tr.appendChild(tdActions);
        statsBody.appendChild(tr);
      }

      const cells = tr.querySelectorAll("td");
      const s = entry.lastStats;

      cells[0].textContent = `#${peerId.slice(-6)}`;
      cells[1].textContent = s?.codec ?? "—";

      const realMbps = ((s?.kbps ?? 0) / 1000).toFixed(1);
      const capMbps = (entry.adapter.maxKbps / 1000).toFixed(1);
      cells[2].textContent = entry.adapter.isReduced
        ? `${realMbps} Mbps (teto ${capMbps})`
        : `${realMbps} Mbps`;

      cells[3].textContent = s ? `${s.fps} fps` : "—";
      cells[4].textContent =
        s && s.rttMs !== null ? `${Math.round(s.rttMs)} ms` : "—";
      cells[5].textContent = formatLimitation(s?.qualityLimitationReason);
      cells[5].className =
        s?.qualityLimitationReason && s.qualityLimitationReason !== "none"
          ? "limit-active"
          : "";
      if (s?.qualityLimitationReason === "cpu") {
        cells[5].title = "CPU sobrecarregada: reduza resolução/FPS ou prefira H.264";
      } else if (entry.adapter.isReduced && entry.adapter.reductionReason) {
        cells[5].title = `Teto reduzido: ${entry.adapter.reductionReason}`;
      } else {
        cells[5].title = "";
      }
    }

    let totalBitrate = 0;
    let totalFps = 0;
    let totalRtt = 0;
    let countWithStats = 0;
    for (const entry of viewers.values()) {
      const s = entry.lastStats;
      if (s) {
        totalBitrate += (s.kbps ?? 0);
        totalFps += (s.fps ?? 0);
        if (s.rttMs !== null) totalRtt += s.rttMs;
        countWithStats++;
      }
    }
    const avgFps = countWithStats > 0 ? Math.round(totalFps / countWithStats) : Number(fpsSelect.value);
    const avgBitrateMbps = countWithStats > 0 ? (totalBitrate / countWithStats / 1000).toFixed(1) : (activeBitrateKbps / 1000).toFixed(1);
    const avgRtt = countWithStats > 0 ? Math.round(totalRtt / countWithStats) : 1;
    if (metricFps) metricFps.textContent = `${avgFps} FPS`;
    if (metricBitrate) metricBitrate.textContent = `${avgBitrateMbps.replace(".", ",")} Mbps`;
    if (metricRtt) metricRtt.textContent = `${avgRtt} ms RTT`;
  };

  uploadInput.addEventListener("input", () => {
    const val = Number(uploadInput.value);
    if (Number.isFinite(val) && val > 0) {
      writeStoredUploadMbps(val);
    }
    updateCapacityUi();
  });

  brSelect.addEventListener("change", updateCapacityUi);
  maxViewersInput.addEventListener("change", updateCapacityUi);
  maxViewersInput.addEventListener("input", updateCapacityUi);
  updateCapacityUi();

  const send = (conn: DataConnection, msg: ToViewer): void => {
    if (conn.open) {
      try {
        void conn.send(msg);
      } catch {
        // Ignora erro ao enviar em canal fechando
      }
    }
  };

  const chatMount = $<HTMLElement>(root, "#host-chat-mount");
  const hostPalco = $<HTMLElement>(root, "#host-palco");

  const myProfile = getProfile();
  const chatHub = new ChatHub({
    hostUser: {
      peerId: "host",
      name: myProfile.displayName || "Anfitrião",
      badge: "host",
      avatar: myProfile.avatarUrl || null,
    },
    onBroadcast: (msg) => {
      for (const { conn } of viewers.values()) {
        send(conn, msg);
      }
    },
    onSendToPeer: (peerId, msg) => {
      const entry = viewers.get(peerId);
      if (entry) {
        send(entry.conn, msg);
      }
    },
    onLocalMessage: (msg) => {
      chatUi.addMessage(msg);
    },
  });

  const chatUi = new ChatUi({
    initialOpen: window.innerWidth >= 900,
    onSendMessage: (text) => {
      chatHub.postHostMessage(text);
    },
    onToggleChange: (isOpen) => {
      hostPalco.classList.toggle("chat-hidden", !isOpen);
    },
  });
  chatMount.replaceWith(chatUi.getElement());
  hostPalco.classList.toggle("chat-hidden", !chatUi.isChatOpen());

  const broadcastCount = (): void => {
    const n = viewers.size;
    countEl.textContent = n === 1 ? "1 espectador" : `${n} espectadores`;
    if (headerViewerCount) headerViewerCount.textContent = `${n} ${n === 1 ? "espectador" : "espectadores"}`;
    if (diagViewerBadge) diagViewerBadge.textContent = `${n} ${n === 1 ? "conectado" : "conectados"}`;
    hostLifecycle?.syncViewers(n);
    for (const { conn } of viewers.values()) send(conn, { t: "viewers", n });
    updateCapacityUi();
    renderStatsTable();
  };

  const dropPending = (id: string, expectedConn?: DataConnection): void => {
    const entry = pendingViewers.get(id);
    if (!entry) return;
    if (expectedConn && entry.conn !== expectedConn) return;
    pendingViewers.delete(id);
    entry.cleanup();
    renderPendingList();
  };

  const dropViewer = (
    id: string,
    expectedConn?: DataConnection,
    silent = false,
  ): void => {
    const entry = viewers.get(id);
    if (!entry) return;
    if (expectedConn && entry.conn !== expectedConn) return;
    viewers.delete(id);
    requestedPresets.delete(id);
    requestedFps.delete(id);
    entry.cleanup();
    if (!silent) broadcastCount();
  };

  const readOptions = (): CaptureOptions & {
    bitrateKbps: number;
    bitrateMode: BitrateAdapterMode;
    hint: ContentHint;
    codecPreset: CodecPreset;
    maxViewers: number;
    password: string;
    requireApproval: boolean;
  } => {
    const rawMax = Number(maxViewersInput.value);
    const maxViewers =
      Number.isInteger(rawMax) && rawMax >= 1 && rawMax <= 30
        ? rawMax
        : DEFAULT_MAX_VIEWERS;
    const bitrateModeSelect = root.querySelector<HTMLSelectElement>("#bitrate-mode");
    const bitrateMode = (bitrateModeSelect?.value ?? "fixed") as BitrateAdapterMode;
    return {
      fps: Number($<HTMLSelectElement>(root, "#fps").value),
      height: Number($<HTMLSelectElement>(root, "#res").value),
      audio: $<HTMLInputElement>(root, "#audio").checked,
      bitrateKbps: Number(brSelect.value),
      bitrateMode,
      hint: $<HTMLSelectElement>(root, "#hint").value as ContentHint,
      codecPreset: $<HTMLSelectElement>(root, "#codec").value as CodecPreset,
      maxViewers,
      password: passwordInput.value,
      requireApproval: requireApprovalInput.checked,
    };
  };

  // Heartbeat a cada 20s para sustentar a sala ativa no catálogo global (/api/rooms)
  const roomHeartbeatTimer =
    typeof fetch !== "undefined"
      ? window.setInterval(() => {
          const activeId = peer?.id || mountOpts.roomId;
          if (!activeId) return;
          const token = mountOpts.hostToken || sessionStorage.getItem("ping:host_token:" + activeId) || "host";
          void fetch("/api/rooms", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: activeId,
              hostToken: token,
              viewers: viewers.size,
              capacity: Number(maxViewersInput.value) || 3,
              isPrivate: Boolean(currentPassword),
              password: currentPassword || undefined,
              hidden: isRoomHidden,
            }),
          }).catch(() => undefined);
        }, 20_000)
      : undefined;

  const stop = (): void => {
    if (roomHeartbeatTimer !== undefined) {
      window.clearInterval(roomHeartbeatTimer);
    }
    const roomIdToClose = peer?.id || mountOpts.roomId;
    if (roomIdToClose) {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(`/api/rooms?action=delete&id=${encodeURIComponent(roomIdToClose)}`);
      }
      if (typeof fetch !== "undefined") {
        void fetch(`/api/rooms?id=${encodeURIComponent(roomIdToClose)}`, {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined);
      }
      try {
        const raw = localStorage.getItem("ping:active_rooms");
        if (raw) {
          const list = JSON.parse(raw) as { id: string }[];
          localStorage.setItem("ping:active_rooms", JSON.stringify(list.filter((r) => r.id !== roomIdToClose)));
        }
        if (typeof BroadcastChannel !== "undefined") {
          const bc = new BroadcastChannel("ping:room_sync_v1");
          bc.postMessage({ t: "rooms-changed" });
          bc.close();
        }
      } catch {}
    }

    if (hostTransport) {
      void hostTransport.stop().catch(() => {});
      hostTransport = null;
    }
    currentTransportInfo = { mode: "p2p" };

    hostLifecycle?.stop();
    hostLifecycle = null;
    clearStartTimeout();
    clearStatsInterval();
    if (currentVideoTrack) {
      currentVideoTrack.removeEventListener("ended", stop);
      currentVideoTrack.removeEventListener("ended", stopLive);
      currentVideoTrack = null;
    }
    chatHub.postSystemMessage("Transmissão encerrada");
    for (const { conn } of pendingViewers.values()) {
      send(conn, { t: "ended" });
    }
    for (const id of [...pendingViewers.keys()]) {
      dropPending(id);
    }
    for (const { conn } of viewers.values()) send(conn, { t: "ended" });
    const currentViewers = [...viewers.keys()];
    const oldPeer = peer;
    peer = null;

    setTimeout(() => {
      for (const id of currentViewers) dropViewer(id, undefined, true);
      approvedClients.clear();
      blockedIds.clear();
      requestedPresets.clear();
      requestedFps.clear();
      failedPasswordAttempts.clear();
      countEl.textContent = "0 espectadores";
      updateCapacityUi();
      renderPendingList();
      renderStatsTable();
      if (oldPeer) {
        oldPeer.removeAllListeners();
        oldPeer.destroy();
      }
    }, 60);

    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    isStreamPaused = false;
    isAudioMuted = false;
    isLiveActive = true;
    hostPausedOverlay.hidden = true;
    hostStoppedOverlay.hidden = true;
    pauseStreamBtn.textContent = "⏸️ Pausar Tela";
    pauseStreamBtn.classList.remove("active");
    stopStreamBtn.textContent = "⏹️ Parar Live";
    stopStreamBtn.classList.remove("active");
    muteAudioBtn.textContent = "🔊 Áudio Ativo";
    muteAudioBtn.classList.remove("active");
    preview.srcObject = null;
    if (previewPlaceholder) previewPlaceholder.hidden = false;
    linkInput.value = "";
    live.hidden = true;
    setup.hidden = false;
    startBtn.disabled = false;
    if (headerConfigBadge) headerConfigBadge.hidden = false;
    if (headerLiveBadge) headerLiveBadge.hidden = true;
    if (headerViewerCount) headerViewerCount.hidden = true;
    if (studioHeadingTitle) studioHeadingTitle.textContent = "Configure sua transmissão";
    updateSetupSummary();
  };

  const stopLive = (): void => {
    if (!isLiveActive) return;
    isLiveActive = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (currentVideoTrack) {
      currentVideoTrack.removeEventListener("ended", stop);
      currentVideoTrack.removeEventListener("ended", stopLive);
      currentVideoTrack = null;
    }
    preview.srcObject = null;
    if (previewPlaceholder) previewPlaceholder.hidden = false;
    hostStoppedOverlay.hidden = false;
    stopStreamBtn.textContent = "▶️ Iniciar Live";
    stopStreamBtn.classList.add("active");
    for (const entry of viewers.values()) {
      send(entry.conn, { t: "pause", paused: true });
    }
    chatHub.postSystemMessage("Transmissão parada");
    toast("Live parada! A sala continua aberta no mesmo link para os seus amigos.");
  };

  const resumeLive = async (): Promise<void> => {
    const opts = readOptions();
    if (passwordInput.value) {
      currentPassword = passwordInput.value;
    }
    opts.password = currentPassword;
    let captured: MediaStream;
    try {
      captured = await captureScreen(opts);
    } catch {
      toast("Captura de tela cancelada.", "info");
      return;
    }
    stream = captured;
    const newVideoTrack = captured.getVideoTracks()[0];
    const newAudioTrack = captured.getAudioTracks()[0];
    if (!newVideoTrack) {
      toast("Nenhuma faixa de vídeo encontrada.", "error");
      return;
    }
    currentVideoTrack = newVideoTrack;
    setContentHint(newVideoTrack, opts.hint);
    newVideoTrack.addEventListener("ended", stopLive);

    if (hostTransport && hostTransport.mode === "sfu") {
      await hostTransport.replaceStream(captured);
    }

    const codecOrder = CODEC_PRESETS[opts.codecPreset] ?? CODEC_PRESETS.vp9;
    for (const entry of viewers.values()) {
      if (entry.pc) {
        for (const sender of entry.pc.getSenders()) {
          if (sender.track?.kind === "video") {
            void sender.replaceTrack(newVideoTrack);
          } else if (sender.track?.kind === "audio" && newAudioTrack) {
            void sender.replaceTrack(newAudioTrack);
          }
        }
        const { kbps, fps, scaleDown } = getPresetParameters(
          entry.qualityPreset,
          entry.adapter.maxKbps,
          opts.fps,
          entry.customFps,
        );
        applyCodecPreferences(entry.pc, codecOrder);
        void capVideoSender(entry.pc, kbps, fps, opts.hint, scaleDown);
      }
      send(entry.conn, { t: "pause", paused: false });
    }

    hostStoppedOverlay.hidden = true;
    preview.srcObject = stream;
    if (previewPlaceholder) previewPlaceholder.hidden = true;
    const tryResumePlay = () => { void preview.play().catch(() => undefined); };
    tryResumePlay();
    preview.onloadedmetadata = tryResumePlay;
    isLiveActive = true;
    stopStreamBtn.textContent = "⏹️ Parar Live";
    stopStreamBtn.classList.remove("active");
    toast("Live iniciada novamente no mesmo link!");
    chatHub.postSystemMessage("Transmissão retomada");
  };

  const updateVisibilityUi = (): void => {
    if (isRoomHidden) {
      toggleVisibilityBtn.textContent = "🙈 Sala Oculta (Apenas Link)";
      toggleVisibilityBtn.classList.add("btn-hidden-active");
      toggleVisibilityBtn.title = "A sala não aparece no lobby de salas. Clique para torná-la visível.";
    } else {
      toggleVisibilityBtn.textContent = "👁️ Sala Visível no Lobby";
      toggleVisibilityBtn.classList.remove("btn-hidden-active");
      toggleVisibilityBtn.title = "A sala aparece no lobby para todos. Clique para ocultá-la.";
    }
  };

  const updatePasswordUi = (): void => {
    if (currentPassword) {
      changePasswordBtn.textContent = `🔑 Senha: ${currentPassword}`;
      changePasswordBtn.title = "Clique para alterar a senha da sala";
      removePasswordBtn.hidden = false;
    } else {
      changePasswordBtn.textContent = "🔑 Colocar Senha";
      changePasswordBtn.title = "Clique para definir uma senha para a sala";
      removePasswordBtn.hidden = true;
    }
  };

  const start = async (): Promise<void> => {
    if (peer || stream) stop();
    const opts = readOptions();
    if (passwordInput.value) {
      currentPassword = passwordInput.value;
    }
    opts.password = currentPassword;
    activeBitrateKbps = opts.bitrateKbps;
    const codecOrder = CODEC_PRESETS[opts.codecPreset] ?? CODEC_PRESETS.vp9;

    const applyViewerQuality = (entry: ViewerEntry): void => {
      if (hostTransport && hostTransport.mode === "sfu") {
        const allFps = [...viewers.values()]
          .map((v) => v.customFps)
          .filter((f): f is number => typeof f === "number");
        const highestFps = allFps.length > 0 ? Math.max(...allFps) : opts.fps;
        let minScale = 1;
        for (const v of viewers.values()) {
          if (v.qualityPreset === "source") { minScale = 1; break; }
          if (v.qualityPreset === "720p" && minScale > 1) minScale = 1;
          if (v.qualityPreset === "480p" && minScale > 1.5) minScale = 1.5;
          if (v.qualityPreset === "360p" && minScale > 2) minScale = 2;
        }
        void hostTransport.applyEncoding({
          maxBitrate: opts.bitrateKbps * 1000,
          maxFramerate: highestFps,
          scaleDown: minScale,
        });
        return;
      }

      if (!entry.pc) return;
      const { kbps, fps, scaleDown } = getPresetParameters(
        entry.qualityPreset,
        entry.adapter.maxKbps,
        opts.fps,
        entry.customFps,
      );
      applyCodecPreferences(entry.pc, codecOrder);
      void capVideoSender(entry.pc, kbps, fps, opts.hint, scaleDown).catch(() => undefined);
    };
    startBtn.disabled = true;

    let captured: MediaStream;
    try {
      captured = await captureScreen(opts);
    } catch {
      toast("Captura cancelada ou negada.", "error");
      startBtn.disabled = false;
      return;
    }
    stream = captured;

    if (opts.audio && captured.getAudioTracks().length === 0) {
      toast(
        "Sem áudio. Marque 'compartilhar áudio' na janela do navegador (Chrome/Edge, tela inteira ou aba).",
      );
    }

    const videoTrack = captured.getVideoTracks()[0];
    if (!videoTrack) {
      toast("Nenhuma faixa de vídeo encontrada.", "error");
      stop();
      return;
    }
    currentVideoTrack = videoTrack;
    setContentHint(videoTrack, opts.hint);
    videoTrack.addEventListener("ended", stopLive);

    const id = mountOpts.roomId || ROOM_PREFIX + shortId(12);
    expectedPwHash =
      currentPassword.length > 0
        ? await hashPassword(id, currentPassword)
        : null;

    const iceServers = await fetchIceServers();
    const p = new Peer(id, peerOptions(iceServers));
    peer = p;

    startTimeout = window.setTimeout(() => {
      if (peer !== p || !live.hidden) return;
      toast(
        "Sinalização indisponível. Tempo esgotado ao conectar ao servidor PeerJS.",
        "error",
      );
      stop();
    }, CONNECT_TIMEOUT_MS);

    p.on("open", async (openedId) => {
      if (peer !== p) return;
      clearStartTimeout();

      // Inicializa SFU se configurado/disponível com fallback silencioso para P2P
      try {
        const mode = await resolveTransportMode();
        if (mode === "sfu" && stream) {
          const sfuTransport = createHostTransport({
            mode: "sfu",
            iceServers,
            onDegrade: (_reason) => {
              void switchToP2P();
            },
          });
          currentTransportInfo = await sfuTransport.start(stream);
          hostTransport = sfuTransport;
        } else {
          currentTransportInfo = { mode: "p2p" };
          hostTransport = null;
        }
      } catch {
        currentTransportInfo = { mode: "p2p" };
        hostTransport = null;
      }

      linkInput.value = `${location.origin}/?room=${openedId}`;
      setup.hidden = true;
      live.hidden = false;
      window.scrollTo(0, 0);
      if (headerConfigBadge) headerConfigBadge.hidden = true;
      if (headerLiveBadge) headerLiveBadge.hidden = false;
      if (headerViewerCount) headerViewerCount.hidden = false;
      if (studioHeadingTitle) studioHeadingTitle.textContent = "Minha transmissão";
      hostStoppedOverlay.hidden = true;
      hostPausedOverlay.hidden = true;
      preview.srcObject = stream;
      if (previewPlaceholder) previewPlaceholder.hidden = true;
      const tryHostPlay = () => { void preview.play().catch(() => undefined); };
      tryHostPlay();
      preview.onloadedmetadata = tryHostPlay;
      updateVisibilityUi();
      updatePasswordUi();
      isLiveActive = true;
      stopStreamBtn.textContent = "⏹️ Parar Live";
      stopStreamBtn.classList.remove("active");
      const token = mountOpts.hostToken || sessionStorage.getItem("ping:host_token:" + openedId) || "host";
      hostLifecycle = startHostLifecycle({ roomId: openedId, hostToken: token });
      if (typeof fetch !== "undefined") {
        void fetch("/api/rooms", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: openedId,
            hostToken: token,
            viewers: viewers.size,
            capacity: opts.maxViewers,
            isPrivate: Boolean(currentPassword),
            password: currentPassword || undefined,
            hidden: isRoomHidden,
          }),
        }).catch(() => undefined);
      }
      broadcastCount();

      clearStatsInterval();
      statsInterval = window.setInterval(async () => {
        if (peer !== p || viewers.size === 0) return;
        await Promise.all(
          [...viewers.values()].map(async (entry) => {
            if (!entry.sampler || !entry.pc) return;
            const sample = await entry.sampler.sample();
            if (!sample) return;
            entry.lastStats = sample;
            entry.diagnosticBuffer.push(sample.diagnostic);
            const { changed } = entry.adapter.update(
              {
                qualityLimitationReason: sample.qualityLimitationReason,
                availableOutgoingBitrateKbps: sample.availableOutgoingBitrateKbps,
                rttMs: sample.rttMs,
                packetLossRatio: sample.packetLossRatio,
              },
              1000,
            );
            if (changed) {
              applyViewerQuality(entry);
            }
          }),
        );
        renderStatsTable();
      }, 1000);
    });

    p.on("disconnected", () => {
      if (peer !== p || p.destroyed) return;
      p.reconnect();
    });

    p.on("error", (err) => {
      if (peer !== p) return;
      const type = String(err.type);
      if (
        type === "network" ||
        type === "server-error" ||
        type === "socket-error" ||
        type === "socket-closed" ||
        type === "ssl-unavailable"
      ) {
        toast(
          "Sinalização indisponível. Verifique sua conexão ou o servidor PeerJS.",
          "error",
        );
      } else {
        toast(`Erro de sinalização: ${type}`, "error");
      }
      if (live.hidden) stop();
    });

    interface VerifiedDiscordUser {
      discordId: string;
      username: string;
      displayName: string;
      avatarUrl: string;
    }
    const verifiedDiscordCache = new Map<string, VerifiedDiscordUser>();

    async function verifyDiscordTicket(peerId: string, ticket: string): Promise<VerifiedDiscordUser | null> {
      const cached = verifiedDiscordCache.get(peerId);
      if (cached) return cached;
      try {
        const res = await fetch("/api/discord-auth?action=verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket, peerId }),
        });
        if (res.ok) {
          const data = (await res.json()) as VerifiedDiscordUser;
          if (data && data.discordId) {
            verifiedDiscordCache.set(peerId, data);
            return data;
          }
        }
      } catch {
        // ignore
      }
      return null;
    }

    p.on("connection", (conn) => {
      if (peer !== p || !stream) {
        conn.close();
        return;
      }

      const { clientId, name: metaName, ticket: metaTicket } = parseConnectionMetadata(conn.metadata);
      let viewerTicket: string | undefined = metaTicket;
      let effectiveViewerName =
        metaName ||
        "Espectador " + (clientId ? clientId.slice(0, 4) : conn.peer.slice(0, 4));
      let effectiveBadge: "discord" | null = null;
      let effectiveAvatar: string | null = null;

      if (viewerTicket) {
        void verifyDiscordTicket(conn.peer, viewerTicket).then((verified) => {
          if (verified) {
            effectiveViewerName = verified.displayName || effectiveViewerName;
            effectiveBadge = "discord";
            effectiveAvatar = verified.avatarUrl;
          }
        });
      }

      const rateLimitKey = clientId ?? conn.peer;

      if (
        blockedIds.has(conn.peer) ||
        (clientId !== undefined && blockedIds.has(clientId))
      ) {
        conn.on("open", () => {
          send(conn, { t: "denied", reason: "blocked" });
          conn.close({ flush: true });
        });
        return;
      }

      let welcomed = false;
      let processingAuth = false;
      let authDelayTimer: number | undefined;
      let setupP2pFn: (() => void) | null = null;

      const clearAuthDelay = (): void => {
        if (authDelayTimer !== undefined) {
          window.clearTimeout(authDelayTimer);
          authDelayTimer = undefined;
        }
      };

      const onConnClose = (): void => {
        clearAuthDelay();
        dropPending(conn.peer, conn);
        dropViewer(conn.peer, conn);
      };
      const onConnError = (): void => {
        clearAuthDelay();
        dropPending(conn.peer, conn);
        dropViewer(conn.peer, conn);
      };

      const admitViewer = async (): Promise<void> => {
        if (peer !== p || !stream || welcomed) return;
        welcomed = true;
        dropPending(conn.peer, conn);

        if (viewerTicket && !effectiveBadge) {
          const verified = await verifyDiscordTicket(conn.peer, viewerTicket);
          if (verified) {
            effectiveViewerName = verified.displayName || effectiveViewerName;
            effectiveBadge = "discord";
            effectiveAvatar = verified.avatarUrl;
          }
        }

        if (clientId) {
          approvedClients.add(clientId);
          for (const [existingPeerId, existingEntry] of viewers.entries()) {
            if (existingEntry.clientId === clientId) {
              dropViewer(existingPeerId, undefined, true);
            }
          }
        }
        approvedClients.add(conn.peer);

        if (viewers.has(conn.peer)) {
          dropViewer(conn.peer, undefined, true);
        }

        if (viewers.size >= opts.maxViewers) {
          send(conn, { t: "denied", reason: "full" });
          conn.close({ flush: true });
          return;
        }

        if (!stream) {
          conn.close();
          return;
        }

        const isSfu = Boolean(hostTransport && hostTransport.mode === "sfu");
        let call: MediaConnection | undefined;
        let pc: RTCPeerConnection | undefined;
        const adapter = new BitrateAdapter(opts.bitrateKbps, {
          mode: opts.bitrateMode,
        });

        const setupP2p = () => {
          if (!stream || peer !== p || !conn.open) return;
          call = p.call(conn.peer, stream, {
            metadata: { room: id },
            sdpTransform: (sdp: string) =>
              preferVideoCodecsInSdp(sdp, codecOrder),
          });
          if (!call) return;
          pc = call.peerConnection as RTCPeerConnection | undefined;
          if (pc) {
            applyCodecPreferences(pc, codecOrder);
            pc.addEventListener("iceconnectionstatechange", onIceStateChange);
            pc.addEventListener("connectionstatechange", onConnStateChange);
          }
          call.on("close", onCallClose);
          call.on("error", onCallError);
          const existing = viewers.get(conn.peer);
          if (existing) {
            existing.call = call;
            existing.pc = pc;
            existing.mode = "p2p";
            existing.sampler = pc
              ? new SenderStatsSampler(
                  pc,
                  () => call?.peerConnection?.getSenders()?.find((s) => s.track?.kind === "video"),
                  () => currentVideoTrack,
                )
              : null;
            apply();
          }
        };

        const apply = (): void => {
          if (!pc) return;
          const existingEntry = viewers.get(conn.peer);
          if (existingEntry) {
            applyViewerQuality(existingEntry);
          } else {
            const { kbps, fps, scaleDown } = getPresetParameters(
              requestedPresets.get(conn.peer),
              adapter.maxKbps,
              opts.fps,
              requestedFps.get(conn.peer),
            );
            applyCodecPreferences(pc, codecOrder);
            void capVideoSender(pc, kbps, fps, opts.hint, scaleDown).catch(() => undefined);
          }
        };

        let iceRecoveryTimer: number | undefined;
        const clearIceTimer = (): void => {
          if (iceRecoveryTimer !== undefined) {
            window.clearTimeout(iceRecoveryTimer);
            iceRecoveryTimer = undefined;
          }
        };

        let cleaned = false;

        const restartMediaIce = async (): Promise<void> => {
          if (
            cleaned ||
            peer !== p ||
            !stream ||
            !pc ||
            pc.signalingState === "closed"
          ) {
            return;
          }
          try {
            applyCodecPreferences(pc, codecOrder);
            if (typeof pc.restartIce === "function") {
              pc.restartIce();
            }
            const offer = await pc.createOffer({ iceRestart: true });
            if (cleaned || (pc.signalingState as string) === "closed") return;
            await pc.setLocalDescription(offer);
          } catch {
            // Se a renegociação local falhar, o espectador reconectará via backoff
          }
        };

        const onIceStateChange = (): void => {
          if (!pc) return;
          const state = pc.iceConnectionState;
          if (state === "connected" || state === "completed") {
            clearIceTimer();
            adapter.reset();
            apply();
          } else if (state === "disconnected" || state === "failed") {
            void restartMediaIce();
            if (iceRecoveryTimer === undefined) {
              iceRecoveryTimer = window.setTimeout(() => {
                iceRecoveryTimer = undefined;
                if (
                  pc &&
                  (pc.iceConnectionState === "disconnected" ||
                    pc.iceConnectionState === "failed" ||
                    pc.iceConnectionState === "closed")
                ) {
                  dropViewer(conn.peer, conn);
                }
              }, 8_000);
            }
          } else if (state === "closed") {
            clearIceTimer();
            dropViewer(conn.peer, conn);
          }
        };

        const onConnStateChange = (): void => {
          if (!pc) return;
          if (pc.connectionState === "connected") {
            adapter.reset();
            apply();
          } else if (pc.connectionState === "closed") {
            dropViewer(conn.peer, conn);
          }
        };

        const onCallClose = (): void => dropViewer(conn.peer, conn);
        const onCallError = (): void => dropViewer(conn.peer, conn);

        setupP2pFn = setupP2p;
        if (!isSfu) {
          setupP2p();
        }

        const cleanup = (): void => {
          if (cleaned) return;
          cleaned = true;
          clearAuthDelay();
          clearIceTimer();
          pc?.removeEventListener("iceconnectionstatechange", onIceStateChange);
          pc?.removeEventListener("connectionstatechange", onConnStateChange);
          if (call) {
            call.off("close", onCallClose);
            call.off("error", onCallError);
            try {
              call.close();
            } catch {
              // Ignora erro ao fechar chamada
            }
          }
          conn.off("data", onData);
          conn.off("close", onConnClose);
          conn.off("error", onConnError);
          try {
            if (conn.open) conn.close({ flush: true });
            else conn.close();
          } catch {
            // Ignora erro ao fechar conexão de dados
          }
          chatHub.postSystemMessage(`${effectiveViewerName} saiu da sala`);
          chatHub.unregisterViewer(conn.peer);
        };

        const diagnosticBuffer = new CircularBuffer<HostDiagnosticSample>(300);
        const entry: ViewerEntry = {
          conn,
          call,
          pc,
          mode: isSfu ? "sfu" : "p2p",
          clientId,
          sampler: pc
            ? new SenderStatsSampler(
                pc,
                () =>
                  call?.peerConnection
                    ?.getSenders()
                    ?.find((s) => s.track?.kind === "video"),
                () => currentVideoTrack,
              )
            : null,
          adapter,
          lastStats: null,
          diagnosticBuffer,
          qualityPreset: requestedPresets.get(conn.peer) ?? "source",
          customFps: requestedFps.get(conn.peer),
          cleanup,
        };
        viewers.set(conn.peer, entry);
        chatHub.registerViewer({
          peerId: conn.peer,
          name: effectiveViewerName,
          badge: effectiveBadge,
          avatar: effectiveAvatar,
        });
        chatHub.sendHistory(conn.peer);
        chatHub.postSystemMessage(`${effectiveViewerName} entrou na sala`);
        applyViewerQuality(entry);
        playJoinChime();
        toast("Um novo espectador entrou na transmissão! 🔔");
        send(conn, { t: "approved", transport: currentTransportInfo });
        send(conn, { t: "welcome", maxFps: opts.fps });
        broadcastCount();
      };

      const onData = (data: unknown): void => {
        if (peer !== p || !stream || processingAuth) return;
        const msg = parseToHost(data);
        if (!msg) return;

        if (msg.t === "hello" && msg.ticket && !effectiveBadge) {
          viewerTicket = msg.ticket;
          void verifyDiscordTicket(conn.peer, msg.ticket).then((verified) => {
            if (verified) {
              effectiveViewerName = verified.displayName || effectiveViewerName;
              effectiveBadge = "discord";
              effectiveAvatar = verified.avatarUrl;
            }
          });
        }

        if (msg.t === "chat-send") {
          chatHub.handleViewerSend(conn.peer, msg.text);
          return;
        }

        if (msg.t === "quality-preset") {
          requestedPresets.set(conn.peer, msg.preset);
          const entry = viewers.get(conn.peer);
          if (entry) {
            entry.qualityPreset = msg.preset;
            applyViewerQuality(entry);
          }
          return;
        }

        if (msg.t === "fps-cap") {
          const clamped = Math.min(Math.max(5, msg.fps), opts.fps);
          requestedFps.set(conn.peer, clamped);
          const entry = viewers.get(conn.peer);
          if (entry) {
            entry.customFps = clamped;
            applyViewerQuality(entry);
          }
          return;
        }

        if (msg.t === "transport-fallback") {
          const targetEntry = viewers.get(conn.peer);
          if (targetEntry) {
            targetEntry.mode = "p2p";
            if (!targetEntry.call && stream && peer === p) {
              setupP2pFn?.();
            }
          }
          return;
        }

        if (welcomed) return;

        // 1. Verifica bloqueio
        if (
          blockedIds.has(conn.peer) ||
          (clientId !== undefined && blockedIds.has(clientId))
        ) {
          send(conn, { t: "denied", reason: "blocked" });
          conn.close({ flush: true });
          return;
        }

        // 2. Verifica capacidade máxima (permitindo reconexão de mesmo clientId)
        const isExistingClient =
          clientId !== undefined &&
          [...viewers.values()].some((v) => v.clientId === clientId);
        if (!isExistingClient && viewers.size >= opts.maxViewers) {
          send(conn, { t: "denied", reason: "full" });
          conn.close({ flush: true });
          return;
        }

        // 3. Verifica senha opcional da sala (hash SHA-256)
        if (expectedPwHash !== null) {
          if (!msg.pwHash) {
            send(conn, { t: "auth-required" });
            return;
          }

          if (msg.pwHash !== expectedPwHash) {
            processingAuth = true;
            const attempts = (failedPasswordAttempts.get(rateLimitKey) ?? 0) + 1;
            failedPasswordAttempts.set(rateLimitKey, attempts);

            authDelayTimer = window.setTimeout(() => {
              authDelayTimer = undefined;
              processingAuth = false;
              if (peer !== p || !conn.open) return;

              if (attempts >= MAX_PW_ATTEMPTS) {
                blockedIds.add(conn.peer);
                if (clientId) blockedIds.add(clientId);
                send(conn, { t: "denied", reason: "wrong-password" });
                conn.close({ flush: true });
              } else {
                send(conn, {
                  t: "auth-required",
                  error: true,
                  remaining: MAX_PW_ATTEMPTS - attempts,
                });
              }
            }, PW_FAILURE_DELAY_MS);
            return;
          }

          failedPasswordAttempts.delete(rateLimitKey);
        }

        // 4. Verifica aprovação manual opcional
        const alreadyApproved =
          approvedClients.has(conn.peer) ||
          (clientId !== undefined && approvedClients.has(clientId));

        if (opts.requireApproval && !alreadyApproved) {
          if (pendingViewers.has(conn.peer)) return;

          // Se já havia um pendente com o mesmo clientId, substitui
          if (clientId) {
            for (const [oldId, oldPending] of pendingViewers.entries()) {
              if (oldPending.clientId === clientId) {
                dropPending(oldId);
              }
            }
          }

          let pendingCleaned = false;
          const cleanupPending = (): void => {
            if (pendingCleaned) return;
            pendingCleaned = true;
            clearAuthDelay();
          };

          pendingViewers.set(conn.peer, {
            conn,
            clientId,
            approve: () => admitViewer(),
            reject: () => {
              send(conn, { t: "denied", reason: "rejected" });
              dropPending(conn.peer, conn);
              conn.close({ flush: true });
            },
            block: () => {
              blockedIds.add(conn.peer);
              if (clientId) blockedIds.add(clientId);
              send(conn, { t: "denied", reason: "blocked" });
              dropPending(conn.peer, conn);
              conn.close({ flush: true });
            },
            cleanup: cleanupPending,
          });
          send(conn, { t: "pending" });
          renderPendingList();
          return;
        }

        admitViewer();
      };

      conn.on("data", onData);
      conn.on("close", onConnClose);
      conn.on("error", onConnError);
    });
  };

  startBtn.addEventListener("click", () => void start());
  stopBtn.addEventListener("click", stop);

  changeSourceBtn.addEventListener("click", async () => {
    if (!stream) return;
    const opts = readOptions();
    try {
      const newStream = await captureScreen(opts);
      const newVideoTrack = newStream.getVideoTracks()[0];
      const newAudioTrack = newStream.getAudioTracks()[0];
      if (!newVideoTrack) {
        toast("Nenhuma faixa de vídeo selecionada.", "error");
        return;
      }
      setContentHint(newVideoTrack, opts.hint);
      if (currentVideoTrack) {
        currentVideoTrack.removeEventListener("ended", stop);
        currentVideoTrack.stop();
      }
      currentVideoTrack = newVideoTrack;
      newVideoTrack.addEventListener("ended", stop);

      if (hostTransport && hostTransport.mode === "sfu") {
        await hostTransport.replaceStream(newStream);
      }

      for (const entry of viewers.values()) {
        if (entry.pc) {
          for (const sender of entry.pc.getSenders()) {
            if (sender.track?.kind === "video") {
              void sender.replaceTrack(newVideoTrack);
            } else if (sender.track?.kind === "audio" && newAudioTrack) {
              void sender.replaceTrack(newAudioTrack);
            }
          }
          const { kbps, fps, scaleDown } = getPresetParameters(
            entry.qualityPreset,
            entry.adapter.maxKbps,
            opts.fps,
            entry.customFps,
          );
          void capVideoSender(entry.pc, kbps, fps, opts.hint, scaleDown);
        }
      }

      stream = newStream;
      preview.srcObject = newStream;
      if (previewPlaceholder) previewPlaceholder.hidden = true;
      void preview.play().catch(() => undefined);
      toast("Fonte de vídeo alterada com sucesso!");
    } catch {
      toast("Alteração de tela cancelada.", "info");
    }
  });

  pauseStreamBtn.addEventListener("click", () => {
    if (!currentVideoTrack) return;
    isStreamPaused = !isStreamPaused;
    currentVideoTrack.enabled = !isStreamPaused;
    hostPausedOverlay.hidden = !isStreamPaused;
    pauseStreamBtn.textContent = isStreamPaused ? "▶️ Retomar Tela" : "⏸️ Pausar Tela";
    pauseStreamBtn.classList.toggle("active", isStreamPaused);

    for (const entry of viewers.values()) {
      send(entry.conn, { t: "pause", paused: isStreamPaused });
    }
    chatHub.postSystemMessage(
      isStreamPaused
        ? "Transmissão pausada pelo anfitrião"
        : "Transmissão retomada",
    );
    toast(isStreamPaused ? "Transmissão pausada." : "Transmissão retomada.");
  });

  muteAudioBtn.addEventListener("click", () => {
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      toast("Sem áudio compartilhado nesta transmissão.", "info");
      return;
    }
    isAudioMuted = !isAudioMuted;
    audioTracks.forEach((t) => {
      t.enabled = !isAudioMuted;
    });
    muteAudioBtn.textContent = isAudioMuted ? "🔇 Áudio Mudo" : "🔊 Áudio Ativo";
    muteAudioBtn.classList.toggle("active", isAudioMuted);
    toast(isAudioMuted ? "Áudio da transmissão silenciado." : "Áudio da transmissão ativado.");
  });
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(linkInput.value);
    toast(ok ? "Link copiado. Cole no Discord." : "Não consegui copiar. Selecione e copie manualmente.");
    if (!ok) linkInput.select();
  });

  const copyDiagBtn = $<HTMLButtonElement>(root, "#copy-diag");
  copyDiagBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const opts = readOptions();
    const track = currentVideoTrack;
    const diagData = {
      role: "host",
      timestamp: new Date().toISOString(),
      roomId: peer?.id ?? "",
      settings: {
        bitrateMode: opts.bitrateMode,
        configuredBitrateKbps: activeBitrateKbps,
        fps: opts.fps,
        resolutionHeight: opts.height,
        codecPreset: opts.codecPreset,
        contentHint: opts.hint,
        uploadLimitMbps: getUploadLimitMbps(),
      },
      trackSettings: track
        ? {
            width: track.getSettings().width,
            height: track.getSettings().height,
            frameRate: track.getSettings().frameRate
              ? Math.round(track.getSettings().frameRate!)
              : undefined,
          }
        : null,
      viewersCount: viewers.size,
      viewers: [...viewers.entries()].map(([id, entry]) => ({
        peerId: id,
        clientId: entry.clientId,
        qualityPreset: entry.qualityPreset ?? "source",
        customFps: entry.customFps,
        currentBitrateCapKbps: entry.adapter.maxKbps,
        isReduced: entry.adapter.isReduced,
        reductionReason: entry.adapter.reductionReason,
        samplesCount: entry.diagnosticBuffer.length,
        samples: entry.diagnosticBuffer.getAll(),
      })),
    };
    (window as any).__pingLastDiag = diagData;
    const ok = await copyText(JSON.stringify(diagData, null, 2));
    toast(
      ok
        ? "Diagnóstico copiado para a área de transferência (JSON)."
        : "Erro ao copiar diagnóstico.",
      ok ? "info" : "error",
    );
  });

  stopStreamBtn.addEventListener("click", () => {
    if (isLiveActive) {
      stopLive();
    } else {
      void resumeLive();
    }
  });

  resumeLiveBtn.addEventListener("click", () => {
    void resumeLive();
  });

  toggleVisibilityBtn.addEventListener("click", () => {
    isRoomHidden = !isRoomHidden;
    updateVisibilityUi();
    const roomId = peer?.id || mountOpts.roomId;
    if (roomId && typeof fetch !== "undefined") {
      void fetch("/api/rooms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: roomId, hidden: isRoomHidden }),
      }).catch(() => undefined);
    }
    try {
      const raw = localStorage.getItem("ping:active_rooms");
      if (raw && roomId) {
        const list = JSON.parse(raw) as (Room & { hidden?: boolean })[];
        const target = list.find((r) => r.id === roomId);
        if (target) {
          target.hidden = isRoomHidden;
          localStorage.setItem("ping:active_rooms", JSON.stringify(list));
        }
      }
    } catch {}
    toast(
      isRoomHidden
        ? "A sala agora está oculta do lobby. Somente amigos com o link podem assistir!"
        : "A sala agora está visível no lobby para todos.",
    );
  });

  const removePassword = async () => {
    currentPassword = "";
    passwordInput.value = "";
    expectedPwHash = null;
    const roomId = peer?.id || mountOpts.roomId;
    if (roomId) {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(`ping:room_pw:${roomId}`);
      }
      if (typeof fetch !== "undefined") {
        void fetch("/api/rooms", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: roomId, password: null, isPrivate: false }),
        }).catch(() => undefined);
      }
      try {
        const raw = localStorage.getItem("ping:active_rooms");
        if (raw) {
          const list = JSON.parse(raw) as (Room & { isPrivate?: boolean })[];
          const target = list.find((r) => r.id === roomId);
          if (target) {
            target.isPrivate = false;
            localStorage.setItem("ping:active_rooms", JSON.stringify(list));
          }
        }
      } catch {}
    }
    updatePasswordUi();
    toast("Senha removida! A sala agora é aberta para todos.");
  };

  changePasswordBtn.addEventListener("click", async () => {
    const newPw = window.prompt("Digite a nova senha para a sala (ou deixe em branco para remover):", currentPassword);
    if (newPw === null) return;
    const trimmed = newPw.trim();
    if (!trimmed) {
      await removePassword();
      return;
    }
    currentPassword = trimmed;
    passwordInput.value = trimmed;
    const roomId = peer?.id || mountOpts.roomId;
    if (roomId) {
      expectedPwHash = await hashPassword(roomId, trimmed);
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(`ping:room_pw:${roomId}`, trimmed);
      }
      if (typeof fetch !== "undefined") {
        void fetch("/api/rooms", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: roomId, password: trimmed, isPrivate: true }),
        }).catch(() => undefined);
      }
      try {
        const raw = localStorage.getItem("ping:active_rooms");
        if (raw) {
          const list = JSON.parse(raw) as (Room & { isPrivate?: boolean })[];
          const target = list.find((r) => r.id === roomId);
          if (target) {
            target.isPrivate = true;
            localStorage.setItem("ping:active_rooms", JSON.stringify(list));
          }
        }
      } catch {}
    }
    updatePasswordUi();
    toast(`Senha da sala alterada para: ${trimmed}`);
  });

  removePasswordBtn.addEventListener("click", removePassword);

  if (hostBackLink && mountOpts.onExit) {
    hostBackLink.addEventListener("click", (e) => {
      e.preventDefault();
      if (!live.hidden && !window.confirm("Encerrar a transmissão atual e voltar às salas?")) {
        return;
      }
      stop();
      mountOpts.onExit?.();
    });
  }

  window.addEventListener("beforeunload", stop);
}
