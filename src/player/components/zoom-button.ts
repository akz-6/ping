import videojs from "video.js";

const Button = videojs.getComponent("Button") as unknown as {
  new (player: any, options?: any): any;
  prototype: any;
};

export class PingZoomButton extends (Button as any) {
  constructor(player: any, options?: any) {
    super(player, options);
    if (typeof this.controlText === "function") {
      this.controlText("Expandir / Zoom");
    }
  }

  createEl() {
    const el = super.createEl("button", {
      className: "vjs-zoom-control vjs-control vjs-button",
      id: "zoom-btn",
      title: "Expandir tela ou redefinir zoom (Z). No celular, use pinça com 2 dedos ou toque duplo.",
    });
    el.setAttribute("aria-label", "Expandir tela ou redefinir zoom");
    el.setAttribute("aria-pressed", "false");
    el.setAttribute("type", "button");
    el.textContent = "Expandir";
    return el;
  }

  handleClick(event: Event) {
    event.stopPropagation();
    this.player().trigger("zoomtoggle");
  }

  setZoomState(scale: number, coverMode: boolean) {
    const el = this.el() as HTMLElement | undefined;
    if (!el) return;
    if (scale > 1.05) {
      el.textContent = `${scale.toFixed(1)}x`;
      el.classList.add("active");
      el.setAttribute("aria-pressed", "true");
      el.setAttribute("title", "Toque para voltar o zoom para 1.0x");
    } else if (coverMode) {
      el.textContent = "Preenchido";
      el.classList.add("active");
      el.setAttribute("aria-pressed", "true");
      el.setAttribute("title", "Voltar ao ajuste original");
    } else {
      el.textContent = "Expandir";
      el.classList.remove("active");
      el.setAttribute("aria-pressed", "false");
      el.setAttribute("title", "Expandir tela ou dar zoom (pinça com 2 dedos / toque duplo)");
    }
  }
}

videojs.registerComponent("PingZoomButton", PingZoomButton as any);
