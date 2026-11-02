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
): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;

    const params = sender.getParameters() as RTCRtpSendParameters & {
      degradationPreference?: string;
    };
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = kbps * 1000;
    params.encodings[0].maxFramerate = fps;
    params.degradationPreference =
      hint === "motion" ? "maintain-framerate" : "maintain-resolution";

    try {
      await sender.setParameters(params);
    } catch {
      // Negociação ainda não terminou ou o navegador recusou: tentamos de novo no "connected".
    }
  }
}

/**
 * Controlador adaptativo de bitrate por espectador:
 * - Se `qualityLimitationReason` for `bandwidth` por mais de 5 s, reduz `maxBitrate` em passos.
 * - Quando estabilizar em `none`, sobe de volta com cautela até o bitrate base configurado.
 */
export class BitrateAdapter {
  private currentKbps: number;
  private bandwidthLimitedMs = 0;
  private stableMs = 0;

  constructor(private readonly baseKbps: number) {
    this.currentKbps = baseKbps;
  }

  get maxKbps(): number {
    return this.currentKbps;
  }

  get isReduced(): boolean {
    return this.currentKbps < this.baseKbps;
  }

  update(
    reason: QualityLimitationReason,
    elapsedMs = 1000,
  ): { changed: boolean; maxKbps: number } {
    if (reason === "bandwidth") {
      this.bandwidthLimitedMs += elapsedMs;
      this.stableMs = 0;

      if (this.bandwidthLimitedMs > 5000) {
        const prev = this.currentKbps;
        const steppedDown = Math.max(
          MIN_ADAPTIVE_BITRATE_KBPS,
          Math.round(this.currentKbps * 0.72),
        );
        this.currentKbps = steppedDown;
        // Mantém 2 s no acumulador para que novos passos ocorram a cada ~3 s se continuar limitado
        this.bandwidthLimitedMs = 2000;
        return { changed: this.currentKbps !== prev, maxKbps: this.currentKbps };
      }
      return { changed: false, maxKbps: this.currentKbps };
    }

    if (reason === "none") {
      this.bandwidthLimitedMs = 0;
      if (this.currentKbps < this.baseKbps) {
        this.stableMs += elapsedMs;
        if (this.stableMs >= 8000) {
          const prev = this.currentKbps;
          const stepUp = Math.max(250, Math.round(this.currentKbps * 0.15));
          this.currentKbps = Math.min(this.baseKbps, this.currentKbps + stepUp);
          this.stableMs = 0;
          return {
            changed: this.currentKbps !== prev,
            maxKbps: this.currentKbps,
          };
        }
      }
      return { changed: false, maxKbps: this.currentKbps };
    }

    // "cpu" ou "other": mantém o bitrate atual sem subir
    this.bandwidthLimitedMs = 0;
    this.stableMs = 0;
    return { changed: false, maxKbps: this.currentKbps };
  }
}
