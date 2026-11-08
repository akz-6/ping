/**
 * Ping v2: componentes visuais do Video.js 8.x (skin Black + Gray).
 *
 * Este módulo NÃO substitui o ping-player.ts existente: ele só registra os componentes da
 * controlBar e exporta as opções. O ping-player.ts continua dono do MediaStream, do protocolo
 * (quality-preset / fps-cap), da reconexão e das estatísticas. Mantenha as assinaturas atuais.
 *
 * Importar sempre depois de './bootstrap' (que define VIDEOJS_NO_DYNAMIC_STYLE = true).
 */
import videojs from 'video.js';

export type LiveState = 'live' | 'paused' | 'reconnecting';

export interface QualityOption { value: string; label: string }
export interface FpsOption { value: number | null; label: string; disabled?: boolean }

export interface SkinHooks {
  qualityOptions(): QualityOption[];            // Auto/Original, 720p, 480p, 360p
  getQuality(): string;
  setQuality(value: string): void;              // dispara 'quality-preset'
  fpsOptions(): FpsOption[];                    // Auto, 240, 144, 120, 60, 30, 15 (acima do teto: disabled)
  getFps(): number | null;
  setFps(value: number | null): void;           // dispara 'fps-cap'
  toggleStats(): void;                          // tecla S: OSD discreto
  toggleChat(): void;                           // tecla C
  toggleTheater(): void;                        // tecla T
}

/* O Video.js 8 não exporta tipos úteis para subclasses; any é intencional e isolado aqui. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const Component: any = videojs.getComponent('Component');
const Button: any = videojs.getComponent('Button');
const MenuButton: any = videojs.getComponent('MenuButton');
const MenuItem: any = videojs.getComponent('MenuItem');

export const PING_CONTROL_BAR_CHILDREN = [
  'pingLiveBadge',
  'volumePanel',
  'customControlSpacer',
  'pingQualityMenu',
  'pingFpsMenu',
  'pingStatsButton',
  'pingChatToggle',
  'pingTheaterButton',
  'pictureInPictureToggle',
  'fullscreenToggle',
];

export const PING_PLAYER_OPTIONS = {
  controls: true,
  fill: true,
  liveui: false,
  preload: 'auto',
  autoplay: 'muted',
  muted: true,
  responsive: true,
  userActions: { hotkeys: false },            // atalhos próprios (M F T P Q S D C)
  textTrackSettings: false,
  bigPlayButton: true,
  controlBar: {
    children: PING_CONTROL_BAR_CHILDREN,
    progressControl: false,
    playToggle: false,
  },
} as const;

const LIVE_TEXT: Record<LiveState, string> = {
  live: 'Ao vivo',
  paused: 'Pausada',
  reconnecting: 'Reconectando',
};

let registered = false;

export function registerPingComponents(hooks: SkinHooks): void {
  if (registered) return;
  registered = true;

  class PingLiveBadge extends Component {
    createEl(): HTMLElement {
      const el = videojs.dom.createEl('div', { className: 'ping-live-badge vjs-control' }) as HTMLElement;
      el.dataset.state = 'live';
      el.textContent = LIVE_TEXT.live;
      el.setAttribute('role', 'status');
      return el;
    }
    setState(state: LiveState): void {
      const el = this.el() as HTMLElement;
      el.dataset.state = state;
      el.textContent = LIVE_TEXT[state];
    }
  }

  function textButton(opts: { label: string; text: string; cls: string; pressed?: () => boolean; onClick: () => void }) {
    return class extends Button {
      constructor(player: unknown, options: unknown) {
        super(player, options);
        const el = this.el() as HTMLButtonElement;
        el.classList.add('ping-btn-text', opts.cls);
        el.textContent = opts.text;
        el.setAttribute('aria-label', opts.label);
        el.setAttribute('title', opts.label);
        if (opts.pressed) el.setAttribute('aria-pressed', String(opts.pressed()));
      }
      handleClick(): void {
        opts.onClick();
        if (opts.pressed) (this.el() as HTMLElement).setAttribute('aria-pressed', String(opts.pressed()));
      }
    };
  }

  function menu<T extends string | number | null>(opts: {
    label: string;
    cls: string;
    items: () => { value: T; label: string; disabled?: boolean }[];
    current: () => T;
    select: (v: T) => void;
  }) {
    return class extends MenuButton {
      constructor(player: unknown, options: unknown) {
        super(player, options);
        const el = this.el() as HTMLElement;
        el.classList.add(opts.cls);
        this.controlText(opts.label);
        this.updateLabel();
      }
      buildCSSClass(): string { return `${opts.cls} ${super.buildCSSClass()}`; }
      updateLabel(): void {
        const current = opts.items().find((i) => i.value === opts.current());
        const holder = (this.el() as HTMLElement).querySelector('.vjs-icon-placeholder');
        if (holder) holder.textContent = current ? current.label : opts.label;
        (holder as HTMLElement | null)?.classList.add('ping-menu-label');
      }
      createItems(): unknown[] {
        return opts.items().map((entry) => {
          const item = new MenuItem(this.player_, { label: entry.label, selectable: true, selected: entry.value === opts.current() });
          if (entry.disabled) {
            item.addClass('vjs-disabled');
            item.el().setAttribute('aria-disabled', 'true');
          }
          item.handleClick = () => {
            if (entry.disabled) return;
            opts.select(entry.value);
            this.update();
            this.updateLabel();
          };
          return item;
        });
      }
    };
  }

  (videojs as any).registerComponent('pingLiveBadge', PingLiveBadge);

  (videojs as any).registerComponent('pingQualityMenu', menu<string>({
    label: 'Qualidade',
    cls: 'ping-quality-menu',
    items: () => hooks.qualityOptions(),
    current: () => hooks.getQuality(),
    select: (v) => hooks.setQuality(v),
  }));

  (videojs as any).registerComponent('pingFpsMenu', menu<number | null>({
    label: 'FPS',
    cls: 'ping-fps-menu',
    items: () => hooks.fpsOptions(),
    current: () => hooks.getFps(),
    select: (v) => hooks.setFps(v),
  }));

  (videojs as any).registerComponent('pingStatsButton', textButton({
    label: 'Estatísticas da conexão (S)', text: 'Stats', cls: 'ping-stats-btn', onClick: () => hooks.toggleStats(),
  }));

  (videojs as any).registerComponent('pingTheaterButton', textButton({
    label: 'Modo teatro (T)', text: 'Teatro', cls: 'ping-theater-btn', onClick: () => hooks.toggleTheater(),
  }));

  class PingChatToggle extends textButton({
    label: 'Mostrar ou ocultar o chat (C)', text: 'Chat', cls: 'chat-toggle', onClick: () => hooks.toggleChat(),
  }) {
    private badge!: HTMLElement;
    constructor(player: unknown, options: unknown) {
      super(player, options);
      this.badge = videojs.dom.createEl('span', { className: 'chat-toggle__badge' }) as HTMLElement;
      (this.el() as HTMLElement).appendChild(this.badge);
    }
    setUnread(count: number): void {
      this.badge.textContent = count > 99 ? '99+' : String(count);
      this.badge.dataset.visible = String(count > 0);
    }
  }
  (videojs as any).registerComponent('pingChatToggle', PingChatToggle);
}

/* Helpers para o ping-player.ts atualizar o skin sem conhecer os componentes. */
export function setLiveState(player: any, state: LiveState): void {
  player.getChild('controlBar')?.getChild('pingLiveBadge')?.setState(state);
}

export function setChatUnread(player: any, count: number): void {
  player.getChild('controlBar')?.getChild('pingChatToggle')?.setUnread(count);
}

export const DEFAULT_QUALITY: QualityOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
];

export function buildFpsOptions(hostCeiling: number): FpsOption[] {
  const steps: (number | null)[] = [null, 240, 144, 120, 60, 30, 15];
  return steps.map((value) => ({
    value,
    label: value === null ? 'Auto' : `${value} FPS`,
    disabled: value !== null && value > hostCeiling,
  }));
}
