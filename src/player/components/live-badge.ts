import videojs from "video.js";

const Component = videojs.getComponent("Component");

export class PingLiveBadge extends Component {
  constructor(player: any, options?: any) {
    super(player, options);
  }

  createEl() {
    const el = videojs.dom.createEl("div", {
      className: "vjs-live-badge discord-live-pill",
      id: "live-badge",
    });
    el.setAttribute("aria-label", "Transmissão Ao Vivo");
    el.setAttribute("role", "status");

    const dot = document.createElement("span");
    dot.className = "pulse-dot";
    dot.setAttribute("aria-hidden", "true");

    const text = document.createElement("span");
    text.className = "vjs-live-text";
    text.textContent = "AO VIVO";

    el.appendChild(dot);
    el.appendChild(text);
    return el;
  }
}

videojs.registerComponent("PingLiveBadge", PingLiveBadge);
