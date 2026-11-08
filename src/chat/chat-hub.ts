import { CircularBuffer } from "../stats";
import { shortId } from "../ui";
import {
  CONTROL_CHARS_RE,
  type ChatRejectedReason,
  type ToViewer,
} from "../protocol";
import type { ChatMsg } from "./types";

export interface ChatUser {
  peerId: string;
  name: string;
  badge: "host" | "discord" | null;
  avatar: string | null;
}

export interface ChatHubOptions {
  hostUser: ChatUser;
  onBroadcast: (msg: ToViewer) => void;
  onSendToPeer: (peerId: string, msg: ToViewer) => void;
  onLocalMessage?: (msg: ChatMsg) => void;
}

interface TokenBucketState {
  tokens: number;
  lastRefill: number;
  violations: number;
  mutedUntil: number;
}

export const BURST_CAPACITY = 3.0;
export const REFILL_INTERVAL_MS = 1200; // 1 msg a cada 1,2s
export const MAX_VIOLATIONS = 5;
export const MUTE_DURATION_MS = 30_000; // 30s de silêncio

export class ChatHub {
  private buffer = new CircularBuffer<ChatMsg>(50);
  private viewers = new Map<string, ChatUser>();
  private rateLimiters = new Map<string, TokenBucketState>();
  private hostUser: ChatUser;

  constructor(private readonly options: ChatHubOptions) {
    this.hostUser = { ...options.hostUser, badge: "host" };
  }

  public updateHostUser(updates: Partial<ChatUser>): void {
    this.hostUser = { ...this.hostUser, ...updates, badge: "host" };
  }

  public registerViewer(user: ChatUser): void {
    this.viewers.set(user.peerId, { ...user });
  }

  public updateViewer(peerId: string, updates: Partial<ChatUser>): void {
    const existing = this.viewers.get(peerId);
    if (existing) {
      this.viewers.set(peerId, { ...existing, ...updates });
    }
  }

  public unregisterViewer(peerId: string): void {
    this.viewers.delete(peerId);
    this.rateLimiters.delete(peerId);
  }

  public checkRate(
    peerId: string,
    now = Date.now(),
  ): { allowed: boolean; reason?: ChatRejectedReason } {
    let state = this.rateLimiters.get(peerId);
    if (!state) {
      state = {
        tokens: BURST_CAPACITY,
        lastRefill: now,
        violations: 0,
        mutedUntil: 0,
      };
      this.rateLimiters.set(peerId, state);
    }

    if (now < state.mutedUntil) {
      return { allowed: false, reason: "muted" };
    }

    const elapsed = Math.max(0, now - state.lastRefill);
    const addedTokens = elapsed / REFILL_INTERVAL_MS;
    state.tokens = Math.min(BURST_CAPACITY, state.tokens + addedTokens);
    state.lastRefill = now;

    if (state.tokens >= 1.0) {
      state.tokens -= 1.0;
      return { allowed: true };
    }

    state.violations += 1;
    if (state.violations >= MAX_VIOLATIONS) {
      state.mutedUntil = now + MUTE_DURATION_MS;
      state.violations = 0;
      return { allowed: false, reason: "muted" };
    }

    return { allowed: false, reason: "rate" };
  }

  public handleViewerSend(
    peerId: string,
    rawText: string,
    now = Date.now(),
  ): { success: boolean; msg?: ChatMsg; rejected?: ChatRejectedReason } {
    const user = this.viewers.get(peerId);
    if (!user) {
      this.options.onSendToPeer(peerId, {
        t: "chat-rejected",
        reason: "invalid",
      });
      return { success: false, rejected: "invalid" };
    }

    const rateResult = this.checkRate(peerId, now);
    if (!rateResult.allowed) {
      const reason = rateResult.reason ?? "rate";
      this.options.onSendToPeer(peerId, {
        t: "chat-rejected",
        reason,
      });
      return { success: false, rejected: reason };
    }

    const trimmed = rawText.trim();
    if (
      trimmed.length === 0 ||
      rawText.length > 300 ||
      CONTROL_CHARS_RE.test(rawText)
    ) {
      this.options.onSendToPeer(peerId, {
        t: "chat-rejected",
        reason: "invalid",
      });
      return { success: false, rejected: "invalid" };
    }

    const msg: ChatMsg = {
      id: shortId(12),
      ts: now,
      kind: "user",
      authorId: user.peerId,
      name: user.name,
      badge: user.badge,
      avatar: user.avatar,
      text: rawText,
    };

    this.buffer.push(msg);
    this.options.onBroadcast({ t: "chat-msg", msg });
    this.options.onLocalMessage?.(msg);
    return { success: true, msg };
  }

  public postHostMessage(
    rawText: string,
    now = Date.now(),
  ): { success: boolean; msg?: ChatMsg } {
    const trimmed = rawText.trim();
    if (
      trimmed.length === 0 ||
      rawText.length > 300 ||
      CONTROL_CHARS_RE.test(rawText)
    ) {
      return { success: false };
    }

    const msg: ChatMsg = {
      id: shortId(12),
      ts: now,
      kind: "user",
      authorId: this.hostUser.peerId,
      name: this.hostUser.name || "Anfitrião",
      badge: "host",
      avatar: this.hostUser.avatar,
      text: rawText,
    };

    this.buffer.push(msg);
    this.options.onBroadcast({ t: "chat-msg", msg });
    this.options.onLocalMessage?.(msg);
    return { success: true, msg };
  }

  public postSystemMessage(text: string, now = Date.now()): ChatMsg {
    const msg: ChatMsg = {
      id: shortId(12),
      ts: now,
      kind: "system",
      authorId: null,
      name: "Sistema",
      badge: null,
      avatar: null,
      text: text.slice(0, 300),
    };

    this.buffer.push(msg);
    this.options.onBroadcast({ t: "chat-msg", msg });
    this.options.onLocalMessage?.(msg);
    return msg;
  }

  public sendHistory(peerId: string): void {
    const msgs = this.buffer.getAll();
    this.options.onSendToPeer(peerId, { t: "chat-history", msgs });
  }

  public getHistory(): ChatMsg[] {
    return this.buffer.getAll();
  }

  public clear(): void {
    this.buffer.clear();
    this.viewers.clear();
    this.rateLimiters.clear();
  }
}
