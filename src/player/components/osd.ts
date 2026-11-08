import videojs from "video.js";

const Component = videojs.getComponent("Component");

export class PingOsd extends Component {
  private textEl: HTMLElement | null = null;
  private unmuteCard: HTMLButtonElement | null = null;
  private hideTimer: number | null = null;

  constructor(player: any, options?: any) {
    super(player, options);
  }

  createEl() {
    const el = videojs.dom.createEl("div", {
      className: "vjs-osd-overlay ping-osd",
      id: "osd",
    }) as HTMLElement;
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.hidden = true;
    el.dataset.visible = "false";

    const text = document.createElement("div");
    text.className = "vjs-osd-text";
    el.appendChild(text);
    this.textEl = text;

    const unmute = document.createElement("button");
    unmute.className = "vjs-unmute-prompt ping-unmute";
    unmute.type = "button";
    unmute.textContent = "🔊 Clique para ativar o som";
    unmute.hidden = true;
    unmute.dataset.visible = "false";
    unmute.addEventListener("click", () => {
      this.player().muted(false);
      this.player().volume(1);
      unmute.hidden = true;
      unmute.dataset.visible = "false";
      this.showToast("Som ativado");
    });
    el.appendChild(unmute);
    this.unmuteCard = unmute;

    return el;
  }

  private getTextElement(): HTMLElement {
    if (!this.textEl) {
      const el = this.el() as HTMLElement;
      this.textEl = (el?.querySelector(".vjs-osd-text") || el) as HTMLElement;
    }
    return this.textEl;
  }

  showState(state: "paused" | "stopped" | "reconnecting" | "live" | "none", message?: string) {
    const el = this.el() as HTMLElement;
    if (!el) return;
    const textNode = this.getTextElement();

    if (state === "none" || state === "live") {
      el.removeAttribute("data-state");
      el.dataset.visible = "false";
      el.hidden = true;
      if (textNode) textNode.textContent = "";
      return;
    }

    el.setAttribute("data-state", state);
    el.dataset.visible = "true";
    el.hidden = false;

    if (textNode) {
      if (message) {
        textNode.textContent = message;
      } else if (state === "paused") {
        textNode.textContent = "Transmissão Pausada";
      } else if (state === "stopped") {
        textNode.textContent = "Transmissão Encerrada";
      } else if (state === "reconnecting") {
        textNode.textContent = "Reconectando à transmissão...";
      }
    }
  }

  showToast(text: string, durationMs = 2500) {
    const el = this.el() as HTMLElement;
    if (!el) return;
    const textNode = this.getTextElement();

    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    el.setAttribute("data-state", "toast");
    el.dataset.visible = "true";
    if (textNode) textNode.textContent = text;
    el.hidden = false;

    this.hideTimer = window.setTimeout(() => {
      if (el.getAttribute("data-state") === "toast") {
        el.removeAttribute("data-state");
        el.dataset.visible = "false";
        el.hidden = true;
        if (textNode) textNode.textContent = "";
      }
    }, durationMs);
  }

  showUnmutePrompt() {
    if (this.unmuteCard) {
      this.unmuteCard.hidden = false;
      this.unmuteCard.dataset.visible = "true";
      const el = this.el() as HTMLElement;
      if (el) {
        el.hidden = false;
        el.dataset.visible = "true";
      }
    }
  }

  toggle(): void {
    const el = this.el() as HTMLElement;
    if (!el) return;
    const isVisible = el.dataset.visible === "true" || !el.hidden;
    if (isVisible) {
      el.dataset.visible = "false";
      el.hidden = true;
    } else {
      el.dataset.visible = "true";
      el.hidden = false;
    }
  }
}

(videojs as any).registerComponent("PingOsd", PingOsd);

