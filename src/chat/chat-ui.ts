import { DISCORD_AVATAR_RE } from "../protocol";
import type { ChatMsg } from "./types";

export interface ChatUiOptions {
  onSendMessage: (text: string) => void;
  onToggleChange?: (isOpen: boolean) => void;
  onUnreadChange?: (count: number) => void;
  initialOpen?: boolean;
}

export class ChatUi {
  private panelEl: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  private unreadCount = 0;
  private isOpen = true;

  constructor(private readonly options: ChatUiOptions) {
    this.isOpen = options.initialOpen ?? true;
    this.panelEl = document.createElement("aside");
    this.panelEl.className = "chat-panel";
    this.panelEl.setAttribute("aria-label", "Chat em tempo real da transmissão");
    if (!this.isOpen) {
      this.panelEl.hidden = true;
    }

    // Header
    const header = document.createElement("div");
    header.className = "chat-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "chat-title-wrap";
    const title = document.createElement("h2");
    title.className = "chat-title";
    title.textContent = "Chat ao Vivo";
    titleWrap.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "chat-header-actions";

    this.closeBtn = document.createElement("button");
    this.closeBtn.type = "button";
    this.closeBtn.className = "chat-btn-icon chat-close-btn";
    this.closeBtn.title = "Ocultar chat (Atalho: C)";
    this.closeBtn.setAttribute("aria-label", "Ocultar chat");
    this.closeBtn.textContent = "✕";
    this.closeBtn.addEventListener("click", () => this.toggleChat(false));
    actions.appendChild(this.closeBtn);

    header.appendChild(titleWrap);
    header.appendChild(actions);
    this.panelEl.appendChild(header);

    // Messages list
    this.messagesEl = document.createElement("div");
    this.messagesEl.className = "chat-messages";
    this.messagesEl.setAttribute("role", "log");
    this.messagesEl.setAttribute("aria-live", "polite");
    this.panelEl.appendChild(this.messagesEl);

    // Input form
    const form = document.createElement("form");
    form.className = "chat-input-wrap";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitMessage();
    });

    this.inputEl = document.createElement("input");
    this.inputEl.type = "text";
    this.inputEl.className = "chat-input";
    this.inputEl.placeholder = "Escreva uma mensagem…";
    this.inputEl.setAttribute("aria-label", "Escreva uma mensagem no chat");
    this.inputEl.maxLength = 300;
    this.inputEl.autocomplete = "off";

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submitMessage();
      }
    });

    this.sendBtn = document.createElement("button");
    this.sendBtn.type = "submit";
    this.sendBtn.className = "chat-send-btn";
    this.sendBtn.textContent = "Enviar";

    form.appendChild(this.inputEl);
    form.appendChild(this.sendBtn);
    this.panelEl.appendChild(form);
  }

  public getElement(): HTMLElement {
    return this.panelEl;
  }

  public isChatOpen(): boolean {
    return this.isOpen;
  }

  public getUnreadCount(): number {
    return this.unreadCount;
  }

  public toggleChat(force?: boolean): void {
    const next = typeof force === "boolean" ? force : !this.isOpen;
    if (this.isOpen === next) return;

    this.isOpen = next;
    this.panelEl.hidden = !this.isOpen;

    if (this.isOpen) {
      this.unreadCount = 0;
      this.options.onUnreadChange?.(0);
      this.scrollToBottom();
      this.inputEl.focus();
    }

    this.options.onToggleChange?.(this.isOpen);
  }

  public loadHistory(msgs: ChatMsg[]): void {
    this.messagesEl.replaceChildren();
    for (const msg of msgs) {
      this.renderMessage(msg);
    }
    this.scrollToBottom();
  }

  public addMessage(msg: ChatMsg): void {
    const wasNearBottom = this.isNearBottom();
    this.renderMessage(msg);

    if (!this.isOpen) {
      this.unreadCount += 1;
      this.options.onUnreadChange?.(this.unreadCount);
    } else if (wasNearBottom) {
      this.scrollToBottom();
    }
  }

  public showNotice(text: string, isError = false): void {
    const notice = document.createElement("div");
    notice.className = `chat-notice ${isError ? "is-error" : ""}`;
    notice.textContent = text;
    this.messagesEl.appendChild(notice);
    this.scrollToBottom();

    window.setTimeout(() => {
      notice.remove();
    }, 5000);
  }

  private isNearBottom(): boolean {
    const threshold = 60;
    const diff =
      this.messagesEl.scrollHeight -
      this.messagesEl.scrollTop -
      this.messagesEl.clientHeight;
    return diff <= threshold;
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private submitMessage(): void {
    const val = this.inputEl.value.trim();
    if (!val || val.length > 300) return;

    this.inputEl.value = "";
    this.options.onSendMessage(val);
  }

  private renderMessage(msg: ChatMsg): void {
    if (msg.kind === "system") {
      const sysEl = document.createElement("div");
      sysEl.className = "chat-msg-system";
      sysEl.textContent = msg.text;
      this.messagesEl.appendChild(sysEl);
      return;
    }

    const row = document.createElement("div");
    row.className = "chat-msg";
    row.dataset.id = msg.id;

    // Avatar
    if (msg.avatar && DISCORD_AVATAR_RE.test(msg.avatar)) {
      const img = document.createElement("img");
      img.className = "chat-avatar";
      img.src = msg.avatar;
      img.alt = msg.name;
      img.addEventListener("error", () => {
        img.replaceWith(this.createMonogram(msg.name));
      });
      row.appendChild(img);
    } else {
      row.appendChild(this.createMonogram(msg.name));
    }

    // Content container
    const content = document.createElement("div");
    content.className = "chat-msg-content";

    // Meta line
    const meta = document.createElement("div");
    meta.className = "chat-msg-meta";

    const author = document.createElement("span");
    author.className = "chat-msg-author";
    author.textContent = msg.name;
    meta.appendChild(author);

    if (msg.badge === "host") {
      const badge = document.createElement("span");
      badge.className = "chat-badge chat-badge-host";
      badge.textContent = "HOST";
      meta.appendChild(badge);
    } else if (msg.badge === "discord") {
      const badge = document.createElement("span");
      badge.className = "chat-badge chat-badge-discord";
      badge.textContent = "@discord";
      meta.appendChild(badge);
    }

    const time = document.createElement("span");
    time.className = "chat-msg-time";
    time.textContent = this.formatTime(msg.ts);
    meta.appendChild(time);

    content.appendChild(meta);

    // Text content (strictly textContent, zero innerHTML)
    const text = document.createElement("div");
    text.className = "chat-msg-text";
    text.textContent = msg.text;
    content.appendChild(text);

    row.appendChild(content);
    this.messagesEl.appendChild(row);
  }

  private createMonogram(name: string): HTMLElement {
    const mono = document.createElement("div");
    mono.className = "chat-msg-monogram";
    const initial = (name.trim()[0] || "?").toUpperCase();
    mono.textContent = initial;
    return mono;
  }

  private formatTime(ts: number): string {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}
