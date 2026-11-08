import videojs from "video.js";

const Button = videojs.getComponent("Button") as unknown as {
  new (player: any, options?: any): any;
  prototype: any;
};

export class PingStatsButton extends (Button as any) {
  constructor(player: any, options?: any) {
    super(player, options);
    if (typeof this.controlText === "function") {
      this.controlText("Estatísticas da Conexão (D)");
    }
  }

  createEl() {
    const el = super.createEl("button", {
      className: "vjs-stats-control vjs-control vjs-button",
      id: "stats-btn",
      title: "Estatísticas da Transmissão (D)",
    });
    el.setAttribute("aria-label", "Estatísticas da Transmissão");
    el.setAttribute("type", "button");

    const label = document.createElement("span");
    label.className = "vjs-stats-label";
    label.textContent = "Stats";
    el.appendChild(label);
    return el;
  }

  handleClick(event: Event) {
    event.stopPropagation();
    this.player().trigger("openstatsmodal");
  }
}

videojs.registerComponent("PingStatsButton", PingStatsButton as any);
