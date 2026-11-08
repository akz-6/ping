import type { HostTransport, ViewerTransport, TransportMode } from "./types";
import {
  PeerJSHostTransport,
  PeerJSViewerTransport,
  type PeerJSHostTransportOptions,
  type PeerJSViewerTransportOptions,
} from "./peerjs-transport";
import {
  CloudflareHostTransport,
  CloudflareViewerTransport,
  type CloudflareHostTransportOptions,
  type CloudflareViewerTransportOptions,
} from "./cloudflare-transport";

export * from "./types";
export * from "./peerjs-transport";
export * from "./cloudflare-transport";

export async function checkSfuHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "health" }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

export function getConfiguredTransportMode(): "sfu" | "p2p" | "auto" {
  const envMode = String(
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_TRANSPORT_MODE) || "",
  ).toLowerCase();
  if (envMode === "sfu") return "sfu";
  if (envMode === "auto") return "auto";
  return "p2p";
}

export async function resolveTransportMode(): Promise<TransportMode> {
  const configured = getConfiguredTransportMode();
  if (configured === "p2p") return "p2p";
  if (configured === "sfu") return "sfu";
  // configured === "auto": testa health na API
  const ok = await checkSfuHealth();
  return ok ? "sfu" : "p2p";
}

export type UnifiedHostTransportOptions =
  | ({ mode?: "p2p" } & PeerJSHostTransportOptions)
  | ({ mode: "sfu" } & CloudflareHostTransportOptions);

export type UnifiedViewerTransportOptions =
  | ({ mode?: "p2p" } & PeerJSViewerTransportOptions)
  | ({ mode: "sfu" } & CloudflareViewerTransportOptions);

export function createHostTransport(opts: UnifiedHostTransportOptions): HostTransport {
  if (opts.mode === "sfu") {
    return new CloudflareHostTransport(opts);
  }
  return new PeerJSHostTransport(opts);
}

export function createViewerTransport(opts: UnifiedViewerTransportOptions): ViewerTransport {
  if (opts.mode === "sfu") {
    return new CloudflareViewerTransport(opts);
  }
  return new PeerJSViewerTransport(opts);
}
