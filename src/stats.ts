export type QualityLimitationReason = "none" | "cpu" | "bandwidth" | "other";
export type ConnectionQuality = "good" | "fair" | "poor";

export interface StatsSample {
  fps: number;
  kbps: number;
  width: number;
  height: number;
  packetsLost: number;
  packetsLostDelta: number;
  rttMs: number | null;
  quality: ConnectionQuality;
}

export interface SenderStatsSample {
  codec: string;
  fps: number;
  kbps: number;
  width: number;
  height: number;
  rttMs: number | null;
  qualityLimitationReason: QualityLimitationReason;
}

function evaluateConnectionQuality(
  fps: number,
  kbps: number,
  packetsLostDelta: number,
  rttMs: number | null,
): ConnectionQuality {
  if (
    (rttMs !== null && rttMs > 280) ||
    packetsLostDelta > 15 ||
    (kbps > 0 && kbps < 500) ||
    (fps > 0 && fps < 12)
  ) {
    return "poor";
  }
  if (
    (rttMs !== null && rttMs > 150) ||
    packetsLostDelta > 3 ||
    (fps > 0 && fps < 24)
  ) {
    return "fair";
  }
  return "good";
}

/** Amostra estatísticas de recepção de vídeo de um RTCPeerConnection. */
export class StatsSampler {
  private lastBytes = 0;
  private lastPacketsLost = 0;
  private lastTs = 0;

  constructor(private readonly pc: RTCPeerConnection) {}

  async sample(): Promise<StatsSample | null> {
    if (this.pc.connectionState === "closed") return null;
    const report = await this.pc.getStats();
    let inbound: any = null;
    let rttMs: number | null = null;

    report.forEach((r: any) => {
      if (r.type === "inbound-rtp" && r.kind === "video") inbound = r;
      if (
        r.type === "candidate-pair" &&
        r.nominated &&
        typeof r.currentRoundTripTime === "number"
      ) {
        rttMs = r.currentRoundTripTime * 1000;
      }
    });

    if (!inbound) return null;

    let kbps = 0;
    if (this.lastTs > 0 && inbound.timestamp > this.lastTs) {
      const bits = Math.max(0, (inbound.bytesReceived ?? 0) - this.lastBytes) * 8;
      kbps = bits / (inbound.timestamp - this.lastTs);
    }
    const packetsLost = Number(inbound.packetsLost ?? 0);
    const packetsLostDelta =
      this.lastTs > 0 ? Math.max(0, packetsLost - this.lastPacketsLost) : 0;

    this.lastBytes = inbound.bytesReceived ?? 0;
    this.lastPacketsLost = packetsLost;
    this.lastTs = inbound.timestamp;

    const fps = Math.round(inbound.framesPerSecond ?? 0);
    const roundedKbps = Math.round(kbps);

    return {
      fps,
      kbps: roundedKbps,
      width: inbound.frameWidth ?? 0,
      height: inbound.frameHeight ?? 0,
      packetsLost,
      packetsLostDelta,
      rttMs,
      quality: evaluateConnectionQuality(
        fps,
        roundedKbps,
        packetsLostDelta,
        rttMs,
      ),
    };
  }
}

/** Amostra estatísticas de envio de vídeo (outbound-rtp) no host por espectador. */
export class SenderStatsSampler {
  private lastBytes = 0;
  private lastFrames = 0;
  private lastTs = 0;

  constructor(private readonly pc: RTCPeerConnection) {}

  async sample(): Promise<SenderStatsSample | null> {
    if (this.pc.connectionState === "closed") return null;
    const report = await this.pc.getStats();
    let outbound: any = null;
    let rttMs: number | null = null;
    const codecs = new Map<string, string>();

    report.forEach((r: any) => {
      if (r.type === "outbound-rtp" && r.kind === "video") {
        outbound = r;
      } else if (
        r.type === "candidate-pair" &&
        (r.nominated || r.state === "succeeded") &&
        typeof r.currentRoundTripTime === "number"
      ) {
        rttMs = r.currentRoundTripTime * 1000;
      } else if (
        rttMs === null &&
        r.type === "remote-inbound-rtp" &&
        r.kind === "video" &&
        typeof r.roundTripTime === "number"
      ) {
        rttMs = r.roundTripTime * 1000;
      } else if (r.type === "codec" && typeof r.mimeType === "string") {
        codecs.set(
          String(r.id),
          r.mimeType.replace(/^video\//i, "").toUpperCase(),
        );
      }
    });

    if (!outbound) return null;

    const dtMs = this.lastTs > 0 ? outbound.timestamp - this.lastTs : 0;
    const bytesSent = Number(outbound.bytesSent ?? 0);
    const framesSent = Number(outbound.framesSent ?? 0);

    let kbps = 0;
    if (dtMs > 0) {
      const bits = Math.max(0, bytesSent - this.lastBytes) * 8;
      kbps = bits / dtMs;
    }

    let fps = Number(outbound.framesPerSecond ?? 0);
    if (!fps && dtMs > 0 && framesSent >= this.lastFrames) {
      fps = ((framesSent - this.lastFrames) * 1000) / dtMs;
    }

    this.lastBytes = bytesSent;
    this.lastFrames = framesSent;
    this.lastTs = outbound.timestamp;

    const rawReason = String(
      outbound.qualityLimitationReason ?? "none",
    ).toLowerCase();
    const qualityLimitationReason: QualityLimitationReason =
      rawReason === "bandwidth" || rawReason === "cpu" || rawReason === "other"
        ? rawReason
        : "none";

    const codec =
      (outbound.codecId && codecs.get(String(outbound.codecId))) || "—";

    return {
      codec,
      fps: Math.round(fps),
      kbps: Math.round(kbps),
      width: Number(outbound.frameWidth ?? 0),
      height: Number(outbound.frameHeight ?? 0),
      rttMs,
      qualityLimitationReason,
    };
  }
}
