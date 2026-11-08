import type { Peer, MediaConnection } from "peerjs";
import type { HostTransport, ViewerTransport, TransportInfo, TransportMode } from "./types";
import {
  preferVideoCodecsInSdp,
  applyCodecPreferences,
  capVideoSender,
  type VideoCodec,
  type ContentHint,
} from "../media";

export interface PeerJSHostTransportOptions {
  peer: Peer;
  roomId: string;
  fps: number;
  hint: ContentHint;
  codecOrder: VideoCodec[];
}

export class PeerJSHostTransport implements HostTransport {
  readonly mode: TransportMode = "p2p";
  private peer: Peer;
  private roomId: string;
  private fps: number;
  private hint: ContentHint;
  private codecOrder: VideoCodec[];
  private currentStream: MediaStream | null = null;
  private calls = new Map<string, MediaConnection>();
  private degradeListeners = new Set<(reason: string) => void>();

  constructor(opts: PeerJSHostTransportOptions) {
    this.peer = opts.peer;
    this.roomId = opts.roomId;
    this.fps = opts.fps;
    this.hint = opts.hint;
    this.codecOrder = opts.codecOrder;
  }

  async start(stream: MediaStream): Promise<TransportInfo> {
    this.currentStream = stream;
    return { mode: "p2p" };
  }

  async attachViewer(viewerId: string): Promise<void> {
    if (!this.currentStream) return;
    const call = this.peer.call(viewerId, this.currentStream, {
      metadata: { room: this.roomId },
      sdpTransform: (sdp: string) => preferVideoCodecsInSdp(sdp, this.codecOrder),
    });
    if (!call) return;
    this.calls.set(viewerId, call);

    const pc = call.peerConnection as RTCPeerConnection | undefined;
    if (pc) {
      applyCodecPreferences(pc, this.codecOrder);
    }

    call.on("close", () => {
      this.calls.delete(viewerId);
    });
    call.on("error", (err) => {
      console.warn(`[PeerJSHostTransport] Erro na chamada com ${viewerId}:`, err);
      this.calls.delete(viewerId);
    });
  }

  detachViewer(viewerId: string): void {
    const call = this.calls.get(viewerId);
    if (call) {
      call.close();
      this.calls.delete(viewerId);
    }
  }

  async replaceStream(stream: MediaStream): Promise<void> {
    this.currentStream = stream;
    const newVideoTrack = stream.getVideoTracks()[0];
    const newAudioTrack = stream.getAudioTracks()[0];

    for (const [id, call] of this.calls.entries()) {
      const pc = call.peerConnection as RTCPeerConnection | undefined;
      if (!pc) continue;

      const senders = pc.getSenders();
      for (const sender of senders) {
        if (sender.track?.kind === "video" && newVideoTrack) {
          await sender.replaceTrack(newVideoTrack).catch((e) => {
            console.warn(`[PeerJSHostTransport] Falha ao substituir track de vídeo para ${id}:`, e);
          });
        } else if (sender.track?.kind === "audio" && newAudioTrack) {
          await sender.replaceTrack(newAudioTrack).catch((e) => {
            console.warn(`[PeerJSHostTransport] Falha ao substituir track de áudio para ${id}:`, e);
          });
        }
      }
    }
  }

  async applyEncoding(p: { maxBitrate: number; maxFramerate: number; scaleDown: number }): Promise<void> {
    const fps = p.maxFramerate || this.fps;
    for (const call of this.calls.values()) {
      const pc = call.peerConnection as RTCPeerConnection | undefined;
      if (!pc) continue;
      const kbps = Math.round(p.maxBitrate / 1000);
      await capVideoSender(pc, kbps, fps, this.hint, p.scaleDown).catch(() => undefined);
    }
  }

  async getStats(viewerId?: string): Promise<RTCStatsReport | null> {
    if (viewerId) {
      const call = this.calls.get(viewerId);
      const pc = call?.peerConnection as RTCPeerConnection | undefined;
      return pc ? await pc.getStats() : null;
    }
    const firstCall = this.calls.values().next().value as MediaConnection | undefined;
    const pc = firstCall?.peerConnection as RTCPeerConnection | undefined;
    return pc ? await pc.getStats() : null;
  }

  onDegrade(cb: (reason: string) => void): void {
    this.degradeListeners.add(cb);
  }

  async stop(): Promise<void> {
    for (const call of this.calls.values()) {
      call.close();
    }
    this.calls.clear();
    this.degradeListeners.clear();
    this.currentStream = null;
  }
}

export interface PeerJSViewerTransportOptions {
  peer: Peer;
}

export class PeerJSViewerTransport implements ViewerTransport {
  private peer: Peer;
  private currentCall: MediaConnection | null = null;
  private failListeners = new Set<(reason: string) => void>();

  constructor(opts: PeerJSViewerTransportOptions) {
    this.peer = opts.peer;
  }

  connect(info: TransportInfo): Promise<MediaStream> {
    return new Promise((resolve, reject) => {
      if (info.mode !== "p2p") {
        const err = new Error(`Modo não suportado por PeerJSViewerTransport: ${info.mode}`);
        for (const cb of this.failListeners) cb(err.message);
        return reject(err);
      }

      const onCall = (call: MediaConnection) => {
        this.currentCall = call;
        call.answer();

        call.on("stream", (remoteStream) => {
          resolve(remoteStream);
        });

        call.on("error", (err) => {
          console.warn("[PeerJSViewerTransport] Erro no call:", err);
          for (const cb of this.failListeners) cb(err?.message || "call-error");
        });

        call.on("close", () => {
          for (const cb of this.failListeners) cb("call-closed");
        });
      };

      this.peer.once("call", onCall);
    });
  }

  onFail(cb: (reason: string) => void): void {
    this.failListeners.add(cb);
  }

  async getStats(): Promise<RTCStatsReport | null> {
    const pc = this.currentCall?.peerConnection as RTCPeerConnection | undefined;
    return pc ? await pc.getStats() : null;
  }

  close(): void {
    if (this.currentCall) {
      this.currentCall.close();
      this.currentCall = null;
    }
    this.failListeners.clear();
  }
}
