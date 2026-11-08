import type { HostTransport, ViewerTransport, TransportMode } from "./types";
import {
  PeerJSHostTransport,
  PeerJSViewerTransport,
  type PeerJSHostTransportOptions,
  type PeerJSViewerTransportOptions,
} from "./peerjs-transport";

export * from "./types";
export * from "./peerjs-transport";

export function getTransportMode(): TransportMode {
  const envMode = String((typeof import.meta !== "undefined" && import.meta.env?.VITE_TRANSPORT_MODE) || "").toLowerCase();
  if (envMode === "sfu") return "sfu";
  if (envMode === "auto") return "p2p";
  return "p2p";
}

export function createHostTransport(opts: PeerJSHostTransportOptions): HostTransport {
  // Inicialmente cria transporte P2P com PeerJS
  return new PeerJSHostTransport(opts);
}

export function createViewerTransport(opts: PeerJSViewerTransportOptions): ViewerTransport {
  return new PeerJSViewerTransport(opts);
}
