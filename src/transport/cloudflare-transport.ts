import type { HostTransport, ViewerTransport, TransportInfo, TransportMode } from "./types";

export interface CloudflareHostTransportOptions {
  iceServers?: RTCIceServer[];
  onDegrade?: (reason: string) => void;
}

export interface CloudflareViewerTransportOptions {
  iceServers?: RTCIceServer[];
  onFail?: (reason: string) => void;
}

export class CloudflareHostTransport implements HostTransport {
  readonly mode: TransportMode = "sfu";
  private pc: RTCPeerConnection | null = null;
  private sessionId: string | null = null;
  private stream: MediaStream | null = null;
  private videoTransceiver: RTCRtpTransceiver | null = null;
  private audioTransceiver: RTCRtpTransceiver | null = null;
  private degradeCb: ((reason: string) => void) | null = null;
  private iceServers: RTCIceServer[];

  constructor(opts?: CloudflareHostTransportOptions) {
    this.iceServers = opts?.iceServers ?? [{ urls: "stun:stun.cloudflare.com:3478" }];
    if (opts?.onDegrade) this.degradeCb = opts.onDegrade;
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  async start(stream: MediaStream): Promise<TransportInfo> {
    this.stream = stream;

    // 1. Cria nova sessão na Cloudflare
    const sessionRes = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "session.new" }),
    });

    if (!sessionRes.ok) {
      throw new Error(`Cloudflare Calls session.new failed: ${sessionRes.status}`);
    }

    const sessionData = (await sessionRes.json()) as { sessionId?: string };
    if (!sessionData.sessionId) {
      throw new Error("No sessionId returned by Cloudflare Calls");
    }
    this.sessionId = sessionData.sessionId;

    // 2. Cria RTCPeerConnection
    this.pc = new RTCPeerConnection({
      bundlePolicy: "max-bundle",
      iceServers: this.iceServers,
    });

    this.pc.addEventListener("connectionstatechange", () => {
      if (this.pc?.connectionState === "failed") {
        this.degradeCb?.("sfu_connection_failed");
      }
    });

    this.pc.addEventListener("iceconnectionstatechange", () => {
      if (this.pc?.iceConnectionState === "failed") {
        this.degradeCb?.("sfu_ice_failed");
      }
    });

    // 3. Adiciona transceivers para envio de mídia
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    if (!videoTrack) {
      throw new Error("No video track found in stream");
    }

    this.videoTransceiver = this.pc.addTransceiver(videoTrack, { direction: "sendonly" });
    if (audioTrack) {
      this.audioTransceiver = this.pc.addTransceiver(audioTrack, { direction: "sendonly" });
    }

    // 4. Cria e define offer local
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Espera reunião de candidatos ICE ou timeout
    if (this.pc.iceGatheringState !== "complete") {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (this.pc?.iceGatheringState === "complete") {
            this.pc.removeEventListener("icegatheringstatechange", check);
            resolve();
          }
        };
        this.pc!.addEventListener("icegatheringstatechange", check);
        setTimeout(() => {
          this.pc?.removeEventListener("icegatheringstatechange", check);
          resolve();
        }, 500);
      });
    }

    // 5. Publica tracks na Cloudflare
    const tracksToPublish = [
      { mid: this.videoTransceiver.mid || "0", trackName: "video" },
      ...(this.audioTransceiver ? [{ mid: this.audioTransceiver.mid || "1", trackName: "audio" }] : []),
    ];

    const pubRes = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "tracks.publish",
        sessionId: this.sessionId,
        sdp: this.pc.localDescription?.sdp || offer.sdp,
        tracks: tracksToPublish,
      }),
    });

    if (!pubRes.ok) {
      throw new Error(`Cloudflare Calls tracks.publish failed: ${pubRes.status}`);
    }

    const pubData = (await pubRes.json()) as { sdp?: string };
    if (!pubData.sdp) {
      throw new Error("No answer SDP returned from Cloudflare Calls");
    }

    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: pubData.sdp }));

    return {
      mode: "sfu",
      sfu: {
        hostSessionId: this.sessionId,
        tracks: [
          { kind: "video", trackName: "video" },
          ...(audioTrack ? [{ kind: "audio" as const, trackName: "audio" }] : []),
        ],
      },
    };
  }

  async attachViewer(_viewerId: string): Promise<void> {
    // No SFU o espectador puxa as faixas diretamente da Cloudflare
    return Promise.resolve();
  }

  detachViewer(_viewerId: string): void {
    // No-op em SFU
  }

  async replaceStream(newStream: MediaStream): Promise<void> {
    this.stream = newStream;
    const newVideo = newStream.getVideoTracks()[0];
    const newAudio = newStream.getAudioTracks()[0];

    if (this.videoTransceiver && newVideo) {
      await this.videoTransceiver.sender.replaceTrack(newVideo);
    }
    if (this.audioTransceiver && newAudio) {
      await this.audioTransceiver.sender.replaceTrack(newAudio);
    }
  }

  async applyEncoding(p: { maxBitrate: number; maxFramerate: number; scaleDown: number }): Promise<void> {
    if (!this.videoTransceiver) return;
    const sender = this.videoTransceiver.sender;
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = p.maxBitrate;
    params.encodings[0].maxFramerate = p.maxFramerate;
    params.encodings[0].scaleResolutionDownBy = p.scaleDown;
    await sender.setParameters(params);
  }

  async getStats(_viewerId?: string): Promise<RTCStatsReport | null> {
    if (!this.pc) return null;
    return this.pc.getStats();
  }

  onDegrade(cb: (reason: string) => void): void {
    this.degradeCb = cb;
  }

  async stop(): Promise<void> {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.sessionId) {
      void fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tracks.close",
          sessionId: this.sessionId,
          mids: ["0", "1"],
        }),
      }).catch(() => {});
      this.sessionId = null;
    }
    this.stream = null;
    this.videoTransceiver = null;
    this.audioTransceiver = null;
  }
}

export class CloudflareViewerTransport implements ViewerTransport {
  private pc: RTCPeerConnection | null = null;
  private sessionId: string | null = null;
  private failCb: ((reason: string) => void) | null = null;
  private outputStream: MediaStream | null = null;
  private iceServers: RTCIceServer[];

  constructor(opts?: CloudflareViewerTransportOptions) {
    this.iceServers = opts?.iceServers ?? [{ urls: "stun:stun.cloudflare.com:3478" }];
    if (opts?.onFail) this.failCb = opts.onFail;
  }

  async connect(info: TransportInfo): Promise<MediaStream> {
    if (info.mode !== "sfu" || !info.sfu?.hostSessionId || !info.sfu.tracks) {
      throw new Error("Invalid SFU transport info");
    }

    // 1. Cria sessão do espectador
    const sessionRes = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "session.new" }),
    });

    if (!sessionRes.ok) {
      throw new Error(`Cloudflare Calls viewer session.new failed: ${sessionRes.status}`);
    }

    const sessionData = (await sessionRes.json()) as { sessionId?: string };
    if (!sessionData.sessionId) {
      throw new Error("No sessionId returned by Cloudflare Calls");
    }
    this.sessionId = sessionData.sessionId;

    // 2. Prepara RTCPeerConnection e stream de saída
    this.pc = new RTCPeerConnection({
      bundlePolicy: "max-bundle",
      iceServers: this.iceServers,
    });

    this.outputStream = new MediaStream();

    this.pc.ontrack = (event) => {
      if (this.outputStream && event.track) {
        this.outputStream.addTrack(event.track);
      }
    };

    this.pc.addEventListener("connectionstatechange", () => {
      if (this.pc?.connectionState === "failed") {
        this.failCb?.("sfu_connection_failed");
      }
    });

    this.pc.addEventListener("iceconnectionstatechange", () => {
      if (this.pc?.iceConnectionState === "failed") {
        this.failCb?.("sfu_ice_failed");
      }
    });

    // 3. Puxa tracks do host
    const pullRes = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "tracks.pull",
        sessionId: this.sessionId,
        remote: {
          sessionId: info.sfu.hostSessionId,
          trackNames: info.sfu.tracks.map((t) => t.trackName),
        },
      }),
    });

    if (!pullRes.ok) {
      throw new Error(`Cloudflare Calls tracks.pull failed: ${pullRes.status}`);
    }

    const pullData = (await pullRes.json()) as { sdp?: string };
    if (!pullData.sdp) {
      throw new Error("No offer SDP returned by Cloudflare Calls pull");
    }

    // 4. Aceita a offer da Cloudflare e envia answer
    await this.pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: pullData.sdp }));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    const renegRes = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "renegotiate",
        sessionId: this.sessionId,
        sdp: answer.sdp,
      }),
    });

    if (!renegRes.ok) {
      throw new Error(`Cloudflare Calls renegotiate failed: ${renegRes.status}`);
    }

    return this.outputStream;
  }

  onFail(cb: (reason: string) => void): void {
    this.failCb = cb;
  }

  async getStats(): Promise<RTCStatsReport | null> {
    if (!this.pc) return null;
    return this.pc.getStats();
  }

  close(): void {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.outputStream) {
      this.outputStream.getTracks().forEach((t) => t.stop());
      this.outputStream = null;
    }
  }
}
