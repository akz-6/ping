export type QualityLimitationReason = "none" | "cpu" | "bandwidth" | "other";
export type ConnectionQuality = "good" | "fair" | "poor";

/** Buffer circular para diagnósticos de até 5 minutos (300 amostras a 1 Hz). */
export class CircularBuffer<T> {
  private items: T[] = [];
  constructor(private readonly capacity = 300) {}

  push(item: T): void {
    if (this.items.length >= this.capacity) {
      this.items.shift();
    }
    this.items.push(item);
  }

  getAll(): T[] {
    return [...this.items];
  }

  get length(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

export interface ViewerDiagnosticSample {
  timestamp: number;
  codec?: string | null;
  fps: number;
  kbps: number;
  width: number;
  height: number;
  rttMs: number | null;
  quality: ConnectionQuality;
  packetsLost: number;
  packetsLostDelta: number;
  framesDropped: number;
  freezeCount: number;
  totalFreezesDuration: number;
  jitterMs: number | null;
  jitterBufferDelayMs: number | null;
  jitterBufferEmittedCount: number | null;
  decoderImplementation: string | null;
}

export interface StatsSample {
  codec?: string;
  fps: number;
  kbps: number;
  width: number;
  height: number;
  packetsLost: number;
  packetsLostDelta: number;
  rttMs: number | null;
  quality: ConnectionQuality;
  diagnostic: ViewerDiagnosticSample;
}

export interface HostDiagnosticSample {
  timestamp: number;
  codec: string;
  fps: number;
  kbps: number;
  width: number;
  height: number;
  rttMs: number | null;
  qualityLimitationReason: QualityLimitationReason;
  qualityLimitationDurations: Record<string, number> | null;
  framesEncoded: number;
  avgQp: number | null;
  targetBitrateKbps: number | null;
  encoderImplementation: string | null;
  powerEfficientEncoder: boolean | null;
  nackCount: number;
  pliCount: number;
  retransmittedPacketsSent: number;
  availableOutgoingBitrateKbps: number | null;
  candidatePair: {
    localCandidateType?: string;
    remoteCandidateType?: string;
    protocol?: string;
  } | null;
  encodingParameters: {
    maxBitrateKbps?: number;
    maxFramerate?: number;
    scaleResolutionDownBy?: number;
  } | null;
  trackSettings: {
    width?: number;
    height?: number;
    frameRate?: number;
  } | null;
}

export interface SenderStatsSample {
  codec: string;
  fps: number;
  kbps: number;
  width: number;
  height: number;
  rttMs: number | null;
  qualityLimitationReason: QualityLimitationReason;
  availableOutgoingBitrateKbps: number | null;
  packetLossRatio: number | null;
  avgQp: number | null;
  diagnostic: HostDiagnosticSample;
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

/** Amostra estatísticas de recepção de vídeo de um RTCPeerConnection (lado do espectador). */
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
    const codecs = new Map<string, string>();

    report.forEach((r: any) => {
      if (r.type === "inbound-rtp" && r.kind === "video") inbound = r;
      if (
        r.type === "candidate-pair" &&
        r.nominated &&
        typeof r.currentRoundTripTime === "number"
      ) {
        rttMs = r.currentRoundTripTime * 1000;
      }
      if (r.type === "codec" && typeof r.mimeType === "string") {
        codecs.set(
          String(r.id),
          r.mimeType.replace(/^video\//i, "").toUpperCase(),
        );
      }
    });

    if (!inbound) return null;

    const codec =
      (inbound.codecId && codecs.get(String(inbound.codecId))) || "VP9";

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
    const width = Number(inbound.frameWidth ?? 0);
    const height = Number(inbound.frameHeight ?? 0);
    const quality = evaluateConnectionQuality(
      fps,
      roundedKbps,
      packetsLostDelta,
      rttMs,
    );

    const framesDropped = Number(inbound.framesDropped ?? 0);
    const freezeCount = Number(inbound.freezeCount ?? 0);
    const totalFreezesDuration = Number(inbound.totalFreezesDuration ?? 0);
    const jitterMs =
      typeof inbound.jitter === "number"
        ? Math.round(inbound.jitter * 1000)
        : null;
    const jitterBufferDelayMs =
      typeof inbound.jitterBufferDelay === "number"
        ? Math.round(inbound.jitterBufferDelay * 1000)
        : null;
    const jitterBufferEmittedCount =
      typeof inbound.jitterBufferEmittedCount === "number"
        ? Number(inbound.jitterBufferEmittedCount)
        : null;
    const decoderImplementation =
      typeof inbound.decoderImplementation === "string"
        ? inbound.decoderImplementation
        : null;

    const diagnostic: ViewerDiagnosticSample = {
      timestamp: Date.now(),
      codec,
      fps,
      kbps: roundedKbps,
      width,
      height,
      rttMs,
      quality,
      packetsLost,
      packetsLostDelta,
      framesDropped,
      freezeCount,
      totalFreezesDuration,
      jitterMs,
      jitterBufferDelayMs,
      jitterBufferEmittedCount,
      decoderImplementation,
    };

    return {
      codec,
      fps,
      kbps: roundedKbps,
      width,
      height,
      packetsLost,
      packetsLostDelta,
      rttMs,
      quality,
      diagnostic,
    };
  }
}

/** Amostra estatísticas de envio de vídeo (outbound-rtp) no host por espectador. */
export class SenderStatsSampler {
  private lastBytes = 0;
  private lastFrames = 0;
  private lastFramesEncoded = 0;
  private lastQpSum = 0;
  private lastPacketsSent = 0;
  private lastRemotePacketsLost = 0;
  private lastTs = 0;

  constructor(
    private readonly pc: RTCPeerConnection,
    private readonly getSender?: () => RTCRtpSender | undefined,
    private readonly getTrack?: () => MediaStreamTrack | null,
  ) {}

  async sample(): Promise<SenderStatsSample | null> {
    if (this.pc.connectionState === "closed") return null;
    const report = await this.pc.getStats();
    let outbound: any = null;
    let remoteInbound: any = null;
    let selectedPair: any = null;
    let rttMs: number | null = null;
    const codecs = new Map<string, string>();
    const candidates = new Map<string, any>();

    report.forEach((r: any) => {
      if (r.type === "outbound-rtp" && r.kind === "video") {
        outbound = r;
      } else if (r.type === "remote-inbound-rtp" && r.kind === "video") {
        remoteInbound = r;
        if (typeof r.roundTripTime === "number") {
          rttMs = r.roundTripTime * 1000;
        }
      } else if (
        r.type === "candidate-pair" &&
        (r.nominated || r.state === "succeeded")
      ) {
        selectedPair = r;
        if (typeof r.currentRoundTripTime === "number") {
          rttMs = r.currentRoundTripTime * 1000;
        }
      } else if (r.type === "local-candidate" || r.type === "remote-candidate") {
        candidates.set(String(r.id), r);
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
    const framesEncoded = Number(outbound.framesEncoded ?? 0);
    const qpSum = Number(outbound.qpSum ?? 0);
    const packetsSent = Number(outbound.packetsSent ?? 0);

    let kbps = 0;
    if (dtMs > 0) {
      const bits = Math.max(0, bytesSent - this.lastBytes) * 8;
      kbps = bits / dtMs;
    }

    let fps = Number(outbound.framesPerSecond ?? 0);
    if (!fps && dtMs > 0 && framesSent >= this.lastFrames) {
      fps = ((framesSent - this.lastFrames) * 1000) / dtMs;
    }

    // Calcula QP médio por intervalo
    let avgQp: number | null = null;
    const deltaEncoded = framesEncoded - this.lastFramesEncoded;
    const deltaQp = qpSum - this.lastQpSum;
    if (deltaEncoded > 0 && deltaQp >= 0 && this.lastFramesEncoded > 0) {
      avgQp = Math.round((deltaQp / deltaEncoded) * 10) / 10;
    }

    // Calcula taxa de perda de pacotes
    let packetLossRatio: number | null = null;
    if (remoteInbound) {
      if (typeof remoteInbound.fractionLost === "number" && remoteInbound.fractionLost >= 0) {
        packetLossRatio =
          remoteInbound.fractionLost > 1
            ? remoteInbound.fractionLost / 256
            : remoteInbound.fractionLost;
      } else if (typeof remoteInbound.packetsLost === "number") {
        const packetsLost = Number(remoteInbound.packetsLost);
        const deltaLost = Math.max(0, packetsLost - this.lastRemotePacketsLost);
        const deltaSent = Math.max(0, packetsSent - this.lastPacketsSent);
        if (deltaLost + deltaSent > 0) {
          packetLossRatio = deltaLost / (deltaLost + deltaSent);
        }
        this.lastRemotePacketsLost = packetsLost;
      }
    }

    this.lastBytes = bytesSent;
    this.lastFrames = framesSent;
    this.lastFramesEncoded = framesEncoded;
    this.lastQpSum = qpSum;
    this.lastPacketsSent = packetsSent;
    this.lastTs = outbound.timestamp;

    const rawReason = String(
      outbound.qualityLimitationReason ?? "none",
    ).toLowerCase();
    const qualityLimitationReason: QualityLimitationReason =
      rawReason === "bandwidth" || rawReason === "cpu" || rawReason === "other"
        ? rawReason
        : "none";

    const qualityLimitationDurations =
      outbound.qualityLimitationDurations &&
      typeof outbound.qualityLimitationDurations === "object"
        ? (outbound.qualityLimitationDurations as Record<string, number>)
        : null;

    const codec =
      (outbound.codecId && codecs.get(String(outbound.codecId))) || "—";

    const availableOutgoingBitrateKbps =
      selectedPair && typeof selectedPair.availableOutgoingBitrate === "number"
        ? Math.round(selectedPair.availableOutgoingBitrate / 1000)
        : null;

    const localCand = selectedPair?.localCandidateId
      ? candidates.get(selectedPair.localCandidateId)
      : null;
    const remoteCand = selectedPair?.remoteCandidateId
      ? candidates.get(selectedPair.remoteCandidateId)
      : null;

    const candidatePair = selectedPair
      ? {
          localCandidateType: localCand?.candidateType,
          remoteCandidateType: remoteCand?.candidateType,
          protocol: selectedPair.protocol ?? localCand?.protocol,
        }
      : null;

    const sender = this.getSender ? this.getSender() : undefined;
    const params = sender?.getParameters();
    const enc0 = params?.encodings?.[0];
    const encodingParameters = enc0
      ? {
          maxBitrateKbps: enc0.maxBitrate
            ? Math.round(enc0.maxBitrate / 1000)
            : undefined,
          maxFramerate: enc0.maxFramerate,
          scaleResolutionDownBy: enc0.scaleResolutionDownBy,
        }
      : null;

    const track = this.getTrack ? this.getTrack() : null;
    const trackSettings = track
      ? {
          width: track.getSettings().width,
          height: track.getSettings().height,
          frameRate: track.getSettings().frameRate
            ? Math.round(track.getSettings().frameRate!)
            : undefined,
        }
      : null;

    const targetBitrateKbps =
      typeof outbound.targetBitrate === "number"
        ? Math.round(outbound.targetBitrate / 1000)
        : null;

    const diagnostic: HostDiagnosticSample = {
      timestamp: Date.now(),
      codec,
      fps: Math.round(fps),
      kbps: Math.round(kbps),
      width: Number(outbound.frameWidth ?? 0),
      height: Number(outbound.frameHeight ?? 0),
      rttMs,
      qualityLimitationReason,
      qualityLimitationDurations,
      framesEncoded,
      avgQp,
      targetBitrateKbps,
      encoderImplementation:
        typeof outbound.encoderImplementation === "string"
          ? outbound.encoderImplementation
          : null,
      powerEfficientEncoder:
        typeof outbound.powerEfficientEncoder === "boolean"
          ? outbound.powerEfficientEncoder
          : null,
      nackCount: Number(outbound.nackCount ?? 0),
      pliCount: Number(outbound.pliCount ?? 0),
      retransmittedPacketsSent: Number(outbound.retransmittedPacketsSent ?? 0),
      availableOutgoingBitrateKbps,
      candidatePair,
      encodingParameters,
      trackSettings,
    };

    return {
      codec,
      fps: Math.round(fps),
      kbps: Math.round(kbps),
      width: Number(outbound.frameWidth ?? 0),
      height: Number(outbound.frameHeight ?? 0),
      rttMs,
      qualityLimitationReason,
      availableOutgoingBitrateKbps,
      packetLossRatio,
      avgQp,
      diagnostic,
    };
  }
}
