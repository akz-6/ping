import videojs from "video.js";

const Button = videojs.getComponent("Button") as unknown as {
  new (player: any, options?: any): any;
  prototype: any;
};

export class PingTheaterButton extends (Button as any) {
  private isTheater = false;

  constructor(player: any, options?: any) {
    super(player, options);
    if (typeof this.controlText === "function") {
      this.controlText("Teatro");
    }
  }

  createEl() {
    const el = super.createEl("button", {
      className: "vjs-theater-control vjs-control vjs-button",
      id: "theater",
      title: "Alternar Modo Teatro (T)",
    });
    el.setAttribute("aria-label", "Alternar Modo Teatro");
    el.setAttribute("type", "button");
    el.textContent = "Teatro";
    return el;
  }

  handleClick(event: Event) {
    event.stopPropagation();
    this.player().trigger("theatermodechange");
  }

  setTheaterState(isTheater: boolean) {
    this.isTheater = isTheater;
    const el = this.el();
    if (el) {
      el.classList.toggle("active", isTheater);
      el.setAttribute("aria-pressed", isTheater ? "true" : "false");
    }
  }

  getTheaterState(): boolean {
    return this.isTheater;
  }
}

videojs.registerComponent("PingTheaterButton", PingTheaterButton as any);
