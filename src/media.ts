import type { QualityLimitationReason } from "./stats";

export type ContentHint = "motion" | "detail";
export type VideoCodec = "VP9" | "AV1" | "H264" | "VP8";
export type CodecPreset = "vp9" | "av1" | "h264" | "vp8";

export const CODEC_PRESETS: Record<CodecPreset, readonly VideoCodec[]> = {
  vp9: ["VP9", "AV1", "H264", "VP8"],
  av1: ["AV1", "VP9", "H264", "VP8"],
  h264: ["H264", "VP9", "AV1", "VP8"],
  vp8: ["VP8", "H264", "VP9", "AV1"],
};

export const MIN_ADAPTIVE_BITRATE_KBPS = 600;

export interface CaptureOptions {
  fps: number;
  height: number;
  audio: boolean;
}

export function captureScreen(o: CaptureOptions): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: { ideal: o.fps, max: o.fps },
      width: { ideal: Math.round((o.height * 16) / 9) },
      height: { ideal: o.height },
    },
    audio: o.audio
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      : false,
  });
}

export function setContentHint(track: MediaStreamTrack, hint: ContentHint): void {
  (track as MediaStreamTrack & { contentHint: string }).contentHint = hint;
}

/**
 * Define a ordem de preferência de codecs de vídeo via RTCRtpTransceiver.setCodecPreferences.
 * Se a API não existir no navegador, ignora silenciosamente sem erro.
 */
export function applyCodecPreferences(
  pc: RTCPeerConnection,
  order: readonly VideoCodec[],
): void {
  try {
    if (
      typeof RTCRtpSender === "undefined" ||
      typeof RTCRtpSender.getCapabilities !== "function" ||
      typeof pc.getTransceivers !== "function"
    ) {
      return;
    }

    const caps = RTCRtpSender.getCapabilities("video");
    if (!caps || !Array.isArray(caps.codecs) || caps.codecs.length === 0) {
      return;
    }

    const ordered: RTCRtpCodec[] = [];
    const used = new Set<RTCRtpCodec>();

    for (const codecName of order) {
      const targetMime = `video/${codecName}`.toLowerCase();
      for (const c of caps.codecs) {
        if (!used.has(c) && c.mimeType.toLowerCase() === targetMime) {
          ordered.push(c);
          used.add(c);
        }
      }
    }

    // Preserva codecs auxiliares (rtx, red, ulpfec, flexfec) e demais fallbacks no final
    for (const c of caps.codecs) {
      if (!used.has(c)) {
        ordered.push(c);
        used.add(c);
      }
    }

    for (const transceiver of pc.getTransceivers()) {
      const kind =
        transceiver.sender?.track?.kind ?? transceiver.receiver?.track?.kind;
      if (kind !== "video") continue;
      if (typeof transceiver.setCodecPreferences !== "function") continue;
      try {
        transceiver.setCodecPreferences(ordered);
      } catch {
        // Ignora caso o navegador recuse a combinação no estado atual
      }
    }
  } catch {
    // Ignora sem erro caso o navegador não suporte setCodecPreferences
  }
}

/**
 * Reordena os payload types na linha m=video do SDP conforme a ordem de codecs preferida.
 * Complementa setCodecPreferences para a oferta inicial criada internamente pelo PeerJS.
 */
export function preferVideoCodecsInSdp(
  sdp: string,
  order: readonly VideoCodec[],
): string {
  try {
    const lines = sdp.split(/\r?\n/);
    const mVideoIdx = lines.findIndex((l) => l.startsWith("m=video "));
    if (mVideoIdx === -1) return sdp;

    const mParts = lines[mVideoIdx].trim().split(/\s+/);
    if (mParts.length <= 4) return sdp;

    const header = mParts.slice(0, 3);
    const payloadTypes = mParts.slice(3);

    // Mapeia PT -> nome do codec (ex.: "98" -> "VP9") e PT primário -> PTs RTX associados
    const ptToCodec = new Map<string, string>();
    const aptToRtxPts = new Map<string, string[]>();

    for (let i = mVideoIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("m=")) break;

      const rtpMatch = /^a=rtpmap:(\d+)\s+([a-zA-Z0-9._-]+)\//i.exec(line);
      if (rtpMatch) {
        ptToCodec.set(rtpMatch[1], rtpMatch[2].toUpperCase());
        continue;
      }

      const fmtpMatch = /^a=fmtp:(\d+)\s+.*?\bapt=(\d+)/i.exec(line);
      if (fmtpMatch) {
        const rtxPt = fmtpMatch[1];
        const apt = fmtpMatch[2];
        const list = aptToRtxPts.get(apt) ?? [];
        list.push(rtxPt);
        aptToRtxPts.set(apt, list);
      }
    }

    const reordered: string[] = [];
    const seen = new Set<string>();
    const addPt = (pt: string): void => {
      if (!seen.has(pt) && payloadTypes.includes(pt)) {
        seen.add(pt);
        reordered.push(pt);
      }
    };

    for (const preferred of order) {
      const target = preferred.toUpperCase();
      for (const pt of payloadTypes) {
        if (ptToCodec.get(pt) === target) {
          addPt(pt);
          for (const rtxPt of aptToRtxPts.get(pt) ?? []) {
            addPt(rtxPt);
          }
        }
      }
    }

    for (const pt of payloadTypes) {
      addPt(pt);
    }

    lines[mVideoIdx] = [...header, ...reordered].join(" ");
    return lines.join("\r\n");
  } catch {
    return sdp;
  }
}

/**
 * Limita bitrate e FPS do vídeo enviado em uma conexão específica.
 * Só tem efeito depois que a negociação terminou; por isso é chamada
 * também quando o estado da conexão vira "connected".
 */
export async function capVideoSender(
  pc: RTCPeerConnection,
  kbps: number,
  fps: number,
  hint: ContentHint,
  scaleResolutionDownBy?: number,
): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;

    try {
      const params = sender.getParameters() as RTCRtpSendParameters & {
        degradationPreference?: string;
      };
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = kbps * 1000;
      params.encodings[0].maxFramerate = fps;
      if (typeof scaleResolutionDownBy === "number" && scaleResolutionDownBy > 1) {
        params.encodings[0].scaleResolutionDownBy = scaleResolutionDownBy;
      } else {
        delete params.encodings[0].scaleResolutionDownBy;
      }
      params.degradationPreference =
        hint === "motion" ? "maintain-framerate" : "maintain-resolution";

      await sender.setParameters(params);
    } catch {
      // Negociação ainda não terminou, conexão fechou ou o navegador recusou
    }
  }
}

export type BitrateAdapterMode = "fixed" | "adaptive";

export interface BitrateAdapterOptions {
  mode?: BitrateAdapterMode;
  floorKbps?: number;
}

export interface NetworkMetrics {
  qualityLimitationReason?: QualityLimitationReason;
  availableOutgoingBitrateKbps?: number | null;
  rttMs?: number | null;
  packetLossRatio?: number | null;
}

/**
 * Controlador de bitrate por espectador.
 *
 * Modo padrão: "fixed" (o teto configurado pelo host nunca é reduzido automaticamente).
 * Modo opcional: "adaptive" (reduz o teto somente sob evidência real e sustentada de rede ruim,
 * e NUNCA por causa isolada de qualityLimitationReason).
 */
export class BitrateAdapter {
  private currentKbps: number;
  private readonly floorKbps: number;
  private mode: BitrateAdapterMode;
  private badNetworkMs = 0;
  private goodNetworkMs = 0;
  private timeSinceLastStepMs = 0;
  private baselineRttMs: number | null = null;
  private lastReductionReason = "";

  constructor(
    private readonly baseKbps: number,
    options: BitrateAdapterOptions = {},
  ) {
    this.currentKbps = baseKbps;
    this.mode = options.mode ?? "fixed";
    // Piso de segurança: 40% do teto configurado e pelo menos 1.5 Mbps (sem ultrapassar o teto base)
    this.floorKbps =
      options.floorKbps ??
      Math.min(baseKbps, Math.max(1500, Math.round(baseKbps * 0.40)));
  }

  get maxKbps(): number {
    return this.currentKbps;
  }

  get isReduced(): boolean {
    return this.currentKbps < this.baseKbps;
  }

  get currentMode(): BitrateAdapterMode {
    return this.mode;
  }

  get configuredFloorKbps(): number {
    return this.floorKbps;
  }

  get reductionReason(): string {
    return this.lastReductionReason;
  }

  setMode(mode: BitrateAdapterMode): void {
    this.mode = mode;
    if (mode === "fixed") {
      this.reset();
    }
  }

  reset(): void {
    this.currentKbps = this.baseKbps;
    this.badNetworkMs = 0;
    this.goodNetworkMs = 0;
    this.timeSinceLastStepMs = 0;
    this.baselineRttMs = null;
    this.lastReductionReason = "";
  }

  update(
    metrics: NetworkMetrics,
    elapsedMs = 1000,
  ): { changed: boolean; maxKbps: number } {
    if (this.mode === "fixed") {
      if (this.currentKbps !== this.baseKbps) {
        this.currentKbps = this.baseKbps;
        return { changed: true, maxKbps: this.currentKbps };
      }
      return { changed: false, maxKbps: this.baseKbps };
    }

    this.timeSinceLastStepMs += elapsedMs;

    // Linha de base de RTT (menor valor observado em condições saudáveis)
    const rtt = metrics.rttMs;
    if (typeof rtt === "number" && rtt > 0) {
      if (this.baselineRttMs === null) {
        this.baselineRttMs = rtt;
      } else if (rtt < this.baselineRttMs) {
        this.baselineRttMs = rtt;
      }
    }

    // 1. availableOutgoingBitrate < 90% do teto atual
    const avail = metrics.availableOutgoingBitrateKbps;
    const isAvailBelowThreshold =
      typeof avail === "number" &&
      avail > 0 &&
      avail < this.currentKbps * 0.90;

    // 2. perda de pacotes sustentada acima de 5%
    const loss = metrics.packetLossRatio;
    const isLossHigh = typeof loss === "number" && loss > 0.05;

    // 3. RTT > 3x a linha de base (com piso de 60 ms para evitar ruído local como 2 ms -> 7 ms)
    const isRttHigh =
      typeof rtt === "number" &&
      this.baselineRttMs !== null &&
      this.baselineRttMs > 0 &&
      rtt > this.baselineRttMs * 3 &&
      rtt > 60;

    // Limitação por CPU nunca reduz bitrate: apenas orienta o usuário
    const isNetworkBad = isAvailBelowThreshold || isLossHigh || isRttHigh;

    if (isNetworkBad) {
      this.badNetworkMs += elapsedMs;
      this.goodNetworkMs = 0;

      // Reduzir somente se sustentado por >= 8 s e com intervalo mínimo de 5 s entre passos
      if (this.badNetworkMs >= 8000 && this.timeSinceLastStepMs >= 5000) {
        const prev = this.currentKbps;
        // Passo de no máximo 15%
        let nextKbps = Math.round(this.currentKbps * 0.85);

        // Nunca reduzir abaixo da estimativa de banda nem abaixo do piso
        nextKbps = Math.max(this.floorKbps, nextKbps);
        if (typeof avail === "number" && avail > 0 && avail < this.currentKbps) {
          nextKbps = Math.max(nextKbps, Math.round(avail));
        }
        nextKbps = Math.min(this.currentKbps, nextKbps);

        if (nextKbps < prev) {
          this.currentKbps = nextKbps;
          this.timeSinceLastStepMs = 0;
          this.badNetworkMs = 3000; // mantém 3 s no acumulador para que novos passos ocorram a cada 5 s se a condição persistir
          this.lastReductionReason = isAvailBelowThreshold
            ? `Banda disponível (${Math.round(avail!)} kbps < 90% do teto)`
            : isLossHigh
              ? `Perda de pacotes (${(loss! * 100).toFixed(1)}% > 5%)`
              : `RTT elevado (${Math.round(rtt!)} ms > 3x base)`;
          return { changed: true, maxKbps: this.currentKbps };
        }
      }
      return { changed: false, maxKbps: this.currentKbps };
    }

    // Rede não está congestionada: zera contador de degradação
    this.badNetworkMs = 0;

    // Recuperação:
    // Se estiver reduzido, estimativa de banda > 120% do teto atual e perda < 1%
    if (this.currentKbps < this.baseKbps) {
      const isAvailHigh =
        typeof avail === "number" && avail > this.currentKbps * 1.20;
      const isLossLow = typeof loss !== "number" || loss < 0.01;
      const isRttNormal =
        this.baselineRttMs === null ||
        typeof rtt !== "number" ||
        rtt <= this.baselineRttMs * 1.5;

      if (isAvailHigh && isLossLow && isRttNormal) {
        this.goodNetworkMs += elapsedMs;
        if (this.goodNetworkMs >= 5000 && this.timeSinceLastStepMs >= 5000) {
          const prev = this.currentKbps;
          const stepUp = Math.max(200, Math.round(this.currentKbps * 0.10));
          this.currentKbps = Math.min(this.baseKbps, this.currentKbps + stepUp);
          this.goodNetworkMs = 0;
          this.timeSinceLastStepMs = 0;
          if (this.currentKbps >= this.baseKbps) {
            this.lastReductionReason = "";
          }
          return { changed: this.currentKbps !== prev, maxKbps: this.currentKbps };
        }
      } else {
        this.goodNetworkMs = 0;
      }
    }

    return { changed: false, maxKbps: this.currentKbps };
  }
}
