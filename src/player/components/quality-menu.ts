import videojs from "video.js";
import type { QualityPreset } from "../../protocol";

const MenuButton = videojs.getComponent("MenuButton") as unknown as {
  new (player: any, options?: any): any;
  prototype: any;
};
const MenuItem = videojs.getComponent("MenuItem") as unknown as {
  new (player: any, options?: any): any;
  prototype: any;
};

export interface QualityItemOptions {
  preset: QualityPreset;
  label: string;
  selected?: boolean;
}

export class PingQualityMenuItem extends (MenuItem as any) {
  preset: QualityPreset;

  constructor(player: any, options: QualityItemOptions) {
    super(player, {
      label: options.label,
      selectable: true,
      selected: !!options.selected,
    });
    this.preset = options.preset;
  }

  handleClick(event: Event) {
    super.handleClick(event);
    this.player().trigger("qualitychange", { preset: this.preset });
  }
}

videojs.registerComponent("PingQualityMenuItem", PingQualityMenuItem as any);

export class PingQualityMenu extends (MenuButton as any) {
  private currentPreset: QualityPreset = "source";
  private labelSpan!: HTMLElement;

  constructor(player: any, options?: any) {
    super(player, options);
    if (typeof this.controlText === "function") {
      this.controlText("Qualidade do Vídeo (Q)");
    }
    if (options?.currentPreset) {
      this.currentPreset = options.currentPreset;
    }
    this.updateLabel();
  }

  createEl() {
    const el = super.createEl();
    el.classList.add("vjs-quality-control", "vjs-menu-button-popup");
    el.setAttribute("id", "quality-menu-btn");

    this.labelSpan = document.createElement("span");
    this.labelSpan.className = "vjs-quality-label";
    this.labelSpan.textContent = "Auto";
    el.appendChild(this.labelSpan);

    return el;
  }

  createItems() {
    const presets: Array<{ preset: QualityPreset; label: string }> = [
      { preset: "source", label: "Auto (Original)" },
      { preset: "720p", label: "720p" },
      { preset: "480p", label: "480p" },
      { preset: "360p", label: "360p" },
    ];

    return presets.map(
      (p) =>
        new PingQualityMenuItem(this.player(), {
          preset: p.preset,
          label: p.label,
          selected: p.preset === this.currentPreset,
        })
    );
  }

  setPreset(preset: QualityPreset) {
    this.currentPreset = preset;
    this.updateLabel();
    if (typeof this.update === "function") {
      this.update();
    }
  }

  getPreset(): QualityPreset {
    return this.currentPreset;
  }

  private updateLabel() {
    if (!this.labelSpan) return;
    switch (this.currentPreset) {
      case "source":
        this.labelSpan.textContent = "Auto";
        break;
      case "720p":
        this.labelSpan.textContent = "720p";
        break;
      case "480p":
        this.labelSpan.textContent = "480p";
        break;
      case "360p":
        this.labelSpan.textContent = "360p";
        break;
    }
  }
}

videojs.registerComponent("PingQualityMenu", PingQualityMenu as any);
