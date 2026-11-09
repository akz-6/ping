import type { FriendsApiError, FriendsSnapshot, HeartbeatBody } from './types';

export type FriendsStatus = 'loading' | 'ready' | 'error';
export type Listener = (snap: FriendsSnapshot | null, status?: FriendsStatus, error?: FriendsApiError | string) => void;

const POLL_MS = 20_000;
const BEAT_MS = 30_000;

export class FriendsService {
  private listeners = new Set<Listener>();
  private snap: FriendsSnapshot | null = null;
  private status: FriendsStatus = 'loading';
  private lastError: FriendsApiError | string = '';
  private pollTimer = 0;
  private beatTimer = 0;
  private context: HeartbeatBody = {};
  private running = false;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snap, this.status, this.lastError);
    return () => this.listeners.delete(fn);
  }

  /** Chamar só com o usuário logado no Discord. Pausa sozinho com a aba oculta. */
  start(): void {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.refresh();
    this.schedule();
  }

  stop(): void {
    this.running = false;
    window.clearInterval(this.pollTimer);
    window.clearInterval(this.beatTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.snap = null;
    this.status = 'loading';
    this.lastError = '';
    this.emit();
  }

  /** Informa onde o usuário está agora (sala que assiste ou transmite). Limpar com {}. */
  setContext(ctx: HeartbeatBody): void {
    this.context = ctx;
    void this.beat();
  }

  async refresh(): Promise<void> {
    const res = await this.call<FriendsSnapshot>('list', 'GET');
    if (res.ok) {
      this.snap = res.data;
      this.status = 'ready';
      this.lastError = '';
    } else {
      this.status = 'error';
      this.lastError = res.error;
    }
    this.emit();
  }

  request(handle: string) { return this.mutate('request', { handle: handle.replace(/^@/, '').trim() }); }
  accept(discordId: string) { return this.mutate('accept', { discordId }); }
  decline(discordId: string) { return this.mutate('decline', { discordId }); }
  remove(discordId: string) { return this.mutate('remove', { discordId }); }
  setShowActivity(showActivity: boolean) { return this.mutate('settings', { showActivity }); }

  private async mutate(action: string, body: Record<string, unknown>) {
    const res = await this.call<{ ok: true }>(action, 'POST', body);
    if (res.ok) await this.refresh();
    return res;
  }

  private async beat(): Promise<void> {
    if (!this.running) return;
    await this.call('heartbeat', 'POST', this.context as Record<string, unknown>);
  }

  private schedule(): void {
    window.clearInterval(this.pollTimer);
    window.clearInterval(this.beatTimer);
    this.pollTimer = window.setInterval(() => void this.refresh(), POLL_MS);
    this.beatTimer = window.setInterval(() => void this.beat(), BEAT_MS);
  }

  private onVisibility = () => {
    if (document.hidden) {
      window.clearInterval(this.pollTimer);
      window.clearInterval(this.beatTimer);
    } else if (this.running) {
      void this.refresh();
      void this.beat();
      this.schedule();
    }
  };

  private emit(): void { this.listeners.forEach((fn) => fn(this.snap, this.status, this.lastError)); }

  private async call<T>(action: string, method: 'GET' | 'POST', body?: Record<string, unknown>):
    Promise<{ ok: true; data: T } | { ok: false; error: FriendsApiError }> {
    try {
      const res = await fetch(`/api/friends?action=${action}`, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) return { ok: false, error: 'unauthenticated' };
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: (json.error as FriendsApiError) ?? 'invalid' };
      return { ok: true, data: json as T };
    } catch {
      return { ok: false, error: 'invalid' };
    }
  }
}
