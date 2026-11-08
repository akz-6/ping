import videojs from "video.js";

const Button = videojs.getComponent("Button") as unknown as {
  new (player: any, options?: any): any;
  prototype: any;
};

export class PingChatButton extends (Button as any) {
  private badgeEl: HTMLElement | null = null;

  constructor(player: any, options?: any) {
    super(player, options);
    if (typeof this.controlText === "function") {
      this.controlText("Chat (C)");
    }
  }

  createEl() {
    const el = super.createEl("button", {
      className: "vjs-chat-control vjs-control vjs-button",
      id: "btn-chat-toggle",
      title: "Alternar Chat da Transmissão (C)",
    });
    el.setAttribute("aria-label", "Alternar Chat da Transmissão (C)");
    el.setAttribute("type", "button");

    const iconSpan = document.createElement("span");
    iconSpan.className = "vjs-chat-label";
    iconSpan.textContent = "💬 Chat";
    el.appendChild(iconSpan);

    const badge = document.createElement("span");
    badge.className = "chat-unread-badge";
    badge.hidden = true;
    badge.textContent = "0";
    el.appendChild(badge);
    this.badgeEl = badge;

    return el;
  }

  handleClick(event: Event) {
    event.stopPropagation();
    this.player().trigger("chattoggle");
  }

  setUnread(count: number): void {
    const el = this.el();
    const badge =
      this.badgeEl ||
      (el?.querySelector(".chat-unread-badge") as HTMLElement | null);
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = false;
        badge.removeAttribute("hidden");
      } else {
        badge.hidden = true;
        badge.setAttribute("hidden", "");
      }
    }
  }

  setActive(isOpen: boolean): void {
    const el = this.el();
    if (el) {
      el.classList.toggle("active", isOpen);
      el.setAttribute("aria-pressed", isOpen ? "true" : "false");
    }
  }
}

videojs.registerComponent("PingChatButton", PingChatButton as any);
