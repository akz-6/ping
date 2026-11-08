export type TransportMode = "sfu" | "p2p";

export interface TransportInfo {
  mode: TransportMode;
  sfu?: {
    hostSessionId: string;
    tracks: { kind: "video" | "audio"; trackName: string }[];
  };
}

export interface HostTransport {
  readonly mode: TransportMode;
  start(stream: MediaStream): Promise<TransportInfo>;
  attachViewer(viewerId: string): Promise<void>; // p2p: peer.call; sfu: no-op
  detachViewer(viewerId: string): void;
  replaceStream(stream: MediaStream): Promise<void>; // Trocar Tela
  applyEncoding(p: { maxBitrate: number; maxFramerate: number; scaleDown: number }): Promise<void>;
  getStats(viewerId?: string): Promise<RTCStatsReport | null>;
  onDegrade(cb: (reason: string) => void): void;
  stop(): Promise<void>;
}

export interface ViewerTransport {
  connect(info: TransportInfo): Promise<MediaStream>;
  onFail(cb: (reason: string) => void): void;
  getStats(): Promise<RTCStatsReport | null>;
  close(): void;
}
