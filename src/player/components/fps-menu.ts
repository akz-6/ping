import videojs from "video.js";

const MenuButton = videojs.getComponent("MenuButton") as unknown as {
  new (player: any, options?: any): any;
  prototype: any;
};
const MenuItem = videojs.getComponent("MenuItem") as unknown as {
  new (player: any, options?: any): any;
  prototype: any;
};

export interface FpsItemOptions {
  fps: "auto" | number;
  label: string;
  selected?: boolean;
  disabled?: boolean;
}

export class PingFpsMenuItem extends (MenuItem as any) {
  fps: "auto" | number;
  disabled: boolean;

  constructor(player: any, options: FpsItemOptions) {
    super(player, {
      label: options.label,
      selectable: !options.disabled,
      selected: !!options.selected,
    });
    this.fps = options.fps;
    this.disabled = !!options.disabled;
    if (this.disabled && typeof this.addClass === "function") {
      this.addClass("vjs-disabled");
    }
  }

  handleClick(event: Event) {
    if (this.disabled) return;
    super.handleClick(event);
    this.player().trigger("fpschange", { fps: this.fps });
  }
}

videojs.registerComponent("PingFpsMenuItem", PingFpsMenuItem as any);

export class PingFpsMenu extends (MenuButton as any) {
  private currentFps: "auto" | number = "auto";
  private hostMaxFps = 60;
  private labelSpan!: HTMLElement;

  constructor(player: any, options?: any) {
    super(player, options);
    if (typeof this.controlText === "function") {
      this.controlText("Taxa de Quadros (FPS)");
    }
    if (options?.hostMaxFps) {
      this.hostMaxFps = options.hostMaxFps;
    }
    this.updateLabel();
  }

  createEl() {
    const el = super.createEl();
    el.classList.add("vjs-fps-control", "vjs-menu-button-popup");
    el.setAttribute("id", "fps-menu-btn");

    this.labelSpan = document.createElement("span");
    this.labelSpan.className = "vjs-fps-label";
    this.labelSpan.textContent = "FPS";
    el.appendChild(this.labelSpan);

    return el;
  }

  createItems() {
    const fpsList: Array<"auto" | number> = ["auto", 240, 144, 120, 60, 30, 15];

    return fpsList.map((fps) => {
      const isAuto = fps === "auto";
      const label = isAuto ? `Auto (${this.hostMaxFps})` : `${fps} FPS`;
      const isDisabled = !isAuto && typeof fps === "number" && fps > this.hostMaxFps;
      const isSelected = this.currentFps === fps;

      return new PingFpsMenuItem(this.player(), {
        fps,
        label,
        selected: isSelected,
        disabled: isDisabled,
      });
    });
  }

  setHostMaxFps(maxFps: number) {
    this.hostMaxFps = maxFps;
    this.updateLabel();
    if (typeof this.update === "function") {
      this.update();
    }
  }

  setFps(fps: "auto" | number) {
    this.currentFps = fps;
    this.updateLabel();
    if (typeof this.update === "function") {
      this.update();
    }
  }

  getFps(): "auto" | number {
    return this.currentFps;
  }

  private updateLabel() {
    if (!this.labelSpan) return;
    if (this.currentFps === "auto") {
      this.labelSpan.textContent = `${this.hostMaxFps}fps`;
    } else {
      this.labelSpan.textContent = `${this.currentFps}fps`;
    }
  }
}

videojs.registerComponent("PingFpsMenu", PingFpsMenu as any);
