import type { QualityPreset } from "../../protocol";
import { createMobileIcon } from "./mobile-icons";

export interface QualityOption {
  value: QualityPreset;
  label: string;
  hint: string;
}

const QUALITY_OPTIONS: QualityOption[] = [
  {
    value: "source",
    label: "Auto (Original)",
    hint: "Mantém a qualidade original do transmissor e adapta automaticamente se necessário.",
  },
  { value: "720p", label: "720p (Rápido)", hint: "Equilíbrio entre nitidez e menor consumo de dados." },
  { value: "480p", label: "480p (Mais Rápido)", hint: "Ideal para 4G ou conexões móveis instáveis." },
  { value: "360p", label: "360p (Super Leve)", hint: "Consumo mínimo de internet e máxima estabilidade." },
];

export interface StatsSnapshot {
  connectionLabel: string;
  connectionLevel: "good" | "fair" | "poor" | "connecting";
  resolution: string;
  fps: string;
  bitrate: string;
  rtt: string;
  codec: string;
  transport: string;
  packetLoss: string;
}

export interface MobileSheetsOptions {
  root: HTMLElement;
  onSelectQuality: (preset: QualityPreset) => void;
  onSelectFps: (fpsChoice: string) => void;
  onCopyDiagnostics: () => void;
}

export class MobileSheets {
  private backdrop: HTMLDivElement;
  private qualitySheet: HTMLElement;
  private statsSheet: HTMLElement;
  private qualityList: HTMLElement;
  private fpsList: HTMLElement;
  private statsGrid: HTMLElement;
  private activeSheet: "quality" | "stats" | null = null;
  private currentQuality: QualityPreset = "source";
  private currentFps = "auto";
  private availableFps: number[] = [60, 30, 15];
  private hostMaxFps = 60;

  constructor(private readonly opts: MobileSheetsOptions) {
    this.backdrop = document.createElement("div");
    this.backdrop.className = "mobile-sheet-backdrop";
    this.backdrop.hidden = true;
    this.backdrop.addEventListener("click", () => this.close());

    // Quality Sheet
    this.qualitySheet = document.createElement("section");
    this.qualitySheet.id = "mobile-quality-sheet";
    this.qualitySheet.className = "mobile-sheet";
    this.qualitySheet.setAttribute("role", "dialog");
    this.qualitySheet.setAttribute("aria-modal", "true");
    this.qualitySheet.setAttribute("aria-labelledby", "mobile-quality-title");
    this.qualitySheet.hidden = true;

    const qHead = this.buildSheetHeader("mobile-quality-title", "Qualidade e FPS");
    this.qualitySheet.appendChild(qHead);

    const qBody = document.createElement("div");
    qBody.className = "mobile-sheet__body";

    const qSecTitle = document.createElement("p");
    qSecTitle.className = "mobile-sheet__section-label";
    qSecTitle.textContent = "Resolução da transmissão";
    qBody.appendChild(qSecTitle);

    this.qualityList = document.createElement("div");
    this.qualityList.className = "mobile-option-list";
    this.qualityList.setAttribute("role", "radiogroup");
    this.qualityList.setAttribute("aria-label", "Resolução da transmissão");
    qBody.appendChild(this.qualityList);

    const fSecTitle = document.createElement("p");
    fSecTitle.className = "mobile-sheet__section-label";
    fSecTitle.textContent = "Taxa de quadros (FPS)";
    qBody.appendChild(fSecTitle);

    this.fpsList = document.createElement("div");
    this.fpsList.className = "mobile-fps-pills";
    this.fpsList.setAttribute("role", "radiogroup");
    this.fpsList.setAttribute("aria-label", "Taxa de quadros");
    qBody.appendChild(this.fpsList);

    this.qualitySheet.appendChild(qBody);

    // Statistics Sheet
    this.statsSheet = document.createElement("section");
    this.statsSheet.id = "mobile-stats-sheet";
    this.statsSheet.className = "mobile-sheet";
    this.statsSheet.setAttribute("role", "dialog");
    this.statsSheet.setAttribute("aria-modal", "true");
    this.statsSheet.setAttribute("aria-labelledby", "mobile-stats-title");
    this.statsSheet.hidden = true;

    const sHead = this.buildSheetHeader("mobile-stats-title", "Estatísticas da conexão");
    this.statsSheet.appendChild(sHead);

    const sBody = document.createElement("div");
    sBody.className = "mobile-sheet__body";

    this.statsGrid = document.createElement("div");
    this.statsGrid.className = "mobile-stats-grid";
    sBody.appendChild(this.statsGrid);

    const diagBtn = document.createElement("button");
    diagBtn.type = "button";
    diagBtn.className = "mobile-sheet__action-btn";
    diagBtn.appendChild(createMobileIcon("copy", 16));
    const diagSpan = document.createElement("span");
    diagSpan.textContent = "Copiar diagnóstico técnico";
    diagBtn.appendChild(diagSpan);
    diagBtn.addEventListener("click", () => {
      this.opts.onCopyDiagnostics();
      diagSpan.textContent = "Diagnóstico copiado!";
      window.setTimeout(() => {
        diagSpan.textContent = "Copiar diagnóstico técnico";
      }, 2000);
    });
    sBody.appendChild(diagBtn);

    this.statsSheet.appendChild(sBody);

    this.opts.root.appendChild(this.backdrop);
    this.opts.root.appendChild(this.qualitySheet);
    this.opts.root.appendChild(this.statsSheet);

    this.renderQualityOptions();
    this.renderFpsOptions();
    this.updateStats({
      connectionLabel: "Conectando…",
      connectionLevel: "connecting",
      resolution: "—",
      fps: "—",
      bitrate: "—",
      rtt: "—",
      codec: "—",
      transport: "WebRTC",
      packetLoss: "—",
    });

    window.addEventListener("keydown", this.onKeyDown);
  }

  private buildSheetHeader(titleId: string, titleText: string): HTMLElement {
    const header = document.createElement("div");
    header.className = "mobile-sheet__head";

    const handle = document.createElement("div");
    handle.className = "mobile-sheet__handle";
    handle.setAttribute("aria-hidden", "true");
    header.appendChild(handle);

    const row = document.createElement("div");
    row.className = "mobile-sheet__title-row";

    const h2 = document.createElement("h2");
    h2.id = titleId;
    h2.className = "mobile-sheet__title";
    h2.textContent = titleText;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mobile-sheet__close";
    closeBtn.setAttribute("aria-label", "Fechar painel");
    closeBtn.appendChild(createMobileIcon("x", 18));
    closeBtn.addEventListener("click", () => this.close());

    row.appendChild(h2);
    row.appendChild(closeBtn);
    header.appendChild(row);
    return header;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.activeSheet !== null) {
      e.preventDefault();
      this.close();
    }
  };

  open(which: "quality" | "stats"): void {
    this.activeSheet = which;
    this.backdrop.hidden = false;
    this.qualitySheet.hidden = which !== "quality";
    this.statsSheet.hidden = which !== "stats";
  }

  close(): void {
    this.activeSheet = null;
    this.backdrop.hidden = true;
    this.qualitySheet.hidden = true;
    this.statsSheet.hidden = true;
  }

  setQuality(preset: QualityPreset): void {
    this.currentQuality = preset;
    this.renderQualityOptions();
  }

  setFps(choice: string, hostMaxFps: number, allowedTiers: number[]): void {
    this.currentFps = choice;
    this.hostMaxFps = hostMaxFps;
    this.availableFps = allowedTiers;
    this.renderFpsOptions();
  }

  private renderQualityOptions(): void {
    this.qualityList.replaceChildren();
    for (const opt of QUALITY_OPTIONS) {
      const active = opt.value === this.currentQuality;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mobile-option-item";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(active));
      btn.classList.toggle("is-active", active);

      const textCol = document.createElement("span");
      textCol.className = "mobile-option-item__text";

      const title = document.createElement("span");
      title.className = "mobile-option-item__label";
      title.textContent = opt.label;

      const hint = document.createElement("span");
      hint.className = "mobile-option-item__hint";
      hint.textContent = opt.hint;

      textCol.appendChild(title);
      textCol.appendChild(hint);
      btn.appendChild(textCol);

      if (active) {
        btn.appendChild(createMobileIcon("check", 18));
      }

      btn.addEventListener("click", () => {
        this.opts.onSelectQuality(opt.value);
        this.close();
      });

      this.qualityList.appendChild(btn);
    }
  }

  private renderFpsOptions(): void {
    this.fpsList.replaceChildren();
    const tiers = ["auto", ...this.availableFps.map(String)];
    for (const val of tiers) {
      const active = val === this.currentFps;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mobile-fps-pill";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", String(active));
      btn.classList.toggle("is-active", active);
      btn.textContent = val === "auto" ? `Auto (${this.hostMaxFps})` : `${val} FPS`;
      btn.addEventListener("click", () => {
        this.opts.onSelectFps(val);
        this.close();
      });
      this.fpsList.appendChild(btn);
    }
  }

  updateStats(s: StatsSnapshot): void {
    const rows: Array<{ label: string; value: string; level?: string }> = [
      { label: "Conexão", value: s.connectionLabel, level: s.connectionLevel },
      { label: "Resolução", value: s.resolution },
      { label: "Taxa de quadros", value: s.fps },
      { label: "Bitrate", value: s.bitrate },
      { label: "Latência (RTT)", value: s.rtt },
      { label: "Codec", value: s.codec },
      { label: "Transporte", value: s.transport },
      { label: "Perda de pacotes", value: s.packetLoss },
    ];

    this.statsGrid.replaceChildren();
    for (const row of rows) {
      const card = document.createElement("div");
      card.className = "mobile-stat-card";

      const lbl = document.createElement("span");
      lbl.className = "mobile-stat-card__label";
      lbl.textContent = row.label;

      const val = document.createElement("span");
      val.className = "mobile-stat-card__value";
      if (row.level) {
        val.dataset.level = row.level;
      }
      val.textContent = row.value;

      card.appendChild(lbl);
      card.appendChild(val);
      this.statsGrid.appendChild(card);
    }
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.backdrop.remove();
    this.qualitySheet.remove();
    this.statsSheet.remove();
  }
}
