import videojs from "video.js";

const Button = videojs.getComponent("Button") as unknown as {
  new (player: any, options?: any): any;
  prototype: any;
};

export class PingRotateButton extends (Button as any) {
  constructor(player: any, options?: any) {
    super(player, options);
    if (typeof this.controlText === "function") {
      this.controlText("Deitar tela");
    }
  }

  createEl() {
    const el = super.createEl("button", {
      className: "vjs-rotate-control vjs-control vjs-button",
      id: "rotate-btn",
      title: "Deitar ou girar tela para assistir na horizontal",
    });
    el.setAttribute("aria-label", "Deitar tela para horizontal");
    el.setAttribute("aria-pressed", "false");
    el.setAttribute("type", "button");
    el.textContent = "Deitar";
    return el;
  }

  handleClick(event: Event) {
    event.stopPropagation();
    this.player().trigger("rotatetoggle");
  }

  setRotated(rotated: boolean) {
    const el = this.el() as HTMLElement | undefined;
    if (!el) return;
    el.classList.toggle("active", rotated);
    el.setAttribute("aria-pressed", String(rotated));
    el.textContent = rotated ? "Normal" : "Deitar";
  }
}

videojs.registerComponent("PingRotateButton", PingRotateButton as any);
