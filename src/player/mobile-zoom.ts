export interface MobileZoomOptions {
  minScale?: number;
  maxScale?: number;
  doubleTapScale?: number;
  onStateChange?: (state: { scale: number; coverMode: boolean }) => void;
  onNotify?: (message: string) => void;
}

export interface MobileZoomController {
  getScale: () => number;
  isCoverMode: () => boolean;
  setCoverMode: (cover: boolean, notify?: boolean) => void;
  toggleCoverMode: () => boolean;
  cycleMobileView: () => void;
  resetZoom: (notify?: boolean) => void;
  destroy: () => void;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function touchDistance(t1: Touch, t2: Touch): number {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.hypot(dx, dy);
}

function touchMidpoint(t1: Touch, t2: Touch): { x: number; y: number } {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      ".vjs-control-bar, .vjs-big-play-button, button, a, select, input, .ping-unmute, .vjs-unmute-prompt",
    ),
  );
}

/**
 * Habilita pinch-to-zoom (2 dedos), arraste (pan) com 1 dedo quando ampliado,
 * toque duplo para zoom 2x e modo "Preencher tela" (object-fit: cover) em Android e iOS.
 */
export function attachMobileZoom(
  stageEl: HTMLElement,
  videoEl: HTMLVideoElement,
  opts: MobileZoomOptions = {},
): MobileZoomController {
  const minScale = opts.minScale ?? 1;
  const maxScale = opts.maxScale ?? 4;
  const doubleTapScale = opts.doubleTapScale ?? 2;

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let coverMode = false;

  // Estado de gestos
  let mode: "none" | "pinch" | "pan" = "none";
  let startDist = 0;
  let startScale = 1;
  let startTx = 0;
  let startTy = 0;
  let startMidX = 0;
  let startMidY = 0;
  let panStartX = 0;
  let panStartY = 0;
  let touchMoved = false;

  // Double-tap
  let lastTapAt = 0;
  let lastTapX = 0;
  let lastTapY = 0;

  const clampPan = (nextTx: number, nextTy: number, s: number): { x: number; y: number } => {
    if (s <= 1.01) return { x: 0, y: 0 };
    const rect = stageEl.getBoundingClientRect();
    const maxX = ((s - 1) * rect.width) / 2;
    const maxY = ((s - 1) * rect.height) / 2;
    return {
      x: clamp(nextTx, -maxX, maxX),
      y: clamp(nextTy, -maxY, maxY),
    };
  };

  const applyTransform = (animate = false): void => {
    const isZoomed = scale > 1.02;
    stageEl.classList.toggle("is-zoomed", isZoomed);
    stageEl.classList.toggle("is-zoom-animating", animate);
    if (!isZoomed) {
      scale = 1;
      tx = 0;
      ty = 0;
      videoEl.style.transform = "";
    } else {
      const clamped = clampPan(tx, ty, scale);
      tx = clamped.x;
      ty = clamped.y;
      videoEl.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
    }
    opts.onStateChange?.({ scale, coverMode });
  };

  const resetZoom = (notify = false): void => {
    scale = 1;
    tx = 0;
    ty = 0;
    applyTransform(true);
    if (notify) {
      opts.onNotify?.("🔍 Zoom 1.0x");
    }
  };

  const setCoverMode = (cover: boolean, notify = true): void => {
    coverMode = cover;
    stageEl.classList.toggle("is-cover-mode", coverMode);
    opts.onStateChange?.({ scale, coverMode });
    if (notify) {
      opts.onNotify?.(coverMode ? "📱 Tela preenchida (Expandido)" : "📱 Ajuste original");
    }
  };

  const toggleCoverMode = (): boolean => {
    setCoverMode(!coverMode, true);
    return coverMode;
  };

  const cycleMobileView = (): void => {
    if (scale > 1.05) {
      resetZoom(true);
      return;
    }
    toggleCoverMode();
  };

  const zoomAtPoint = (clientX: number, clientY: number, nextScale: number): void => {
    const rect = stageEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const offsetX = clientX - cx;
    const offsetY = clientY - cy;

    scale = clamp(nextScale, minScale, maxScale);
    if (scale <= 1.02) {
      scale = 1;
      tx = 0;
      ty = 0;
    } else {
      tx = -offsetX * (scale - 1) * 0.65;
      ty = -offsetY * (scale - 1) * 0.65;
    }
    applyTransform(true);
  };

  const onTouchStart = (e: TouchEvent): void => {
    if (isInteractiveTarget(e.target)) return;

    if (e.touches.length === 2) {
      mode = "pinch";
      touchMoved = true;
      startDist = touchDistance(e.touches[0], e.touches[1]);
      startScale = scale;
      startTx = tx;
      startTy = ty;
      const mid = touchMidpoint(e.touches[0], e.touches[1]);
      startMidX = mid.x;
      startMidY = mid.y;
      stageEl.classList.remove("is-zoom-animating");
      return;
    }

    if (e.touches.length === 1) {
      touchMoved = false;
      panStartX = e.touches[0].clientX;
      panStartY = e.touches[0].clientY;
      if (scale > 1.02) {
        mode = "pan";
        startTx = tx;
        startTy = ty;
        stageEl.classList.remove("is-zoom-animating");
      } else {
        mode = "none";
      }
    }
  };

  const onTouchMove = (e: TouchEvent): void => {
    if (mode === "pinch" && e.touches.length === 2) {
      e.preventDefault();
      const dist = touchDistance(e.touches[0], e.touches[1]);
      if (startDist > 0) {
        const nextScale = clamp(startScale * (dist / startDist), minScale, maxScale);
        const mid = touchMidpoint(e.touches[0], e.touches[1]);
        const rect = stageEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        const ratio = nextScale / startScale;
        const dx = mid.x - startMidX;
        const dy = mid.y - startMidY;

        scale = nextScale;
        tx = (startTx - (startMidX - cx)) * ratio + (startMidX - cx) + dx;
        ty = (startTy - (startMidY - cy)) * ratio + (startMidY - cy) + dy;
        applyTransform(false);
      }
      return;
    }

    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - panStartX;
      const dy = e.touches[0].clientY - panStartY;
      if (Math.hypot(dx, dy) > 8) {
        touchMoved = true;
      }
      if (mode === "pan" && scale > 1.02) {
        e.preventDefault();
        tx = startTx + dx;
        ty = startTy + dy;
        applyTransform(false);
      }
    }
  };

  const onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length === 1 && mode === "pinch") {
      // Transição suave de pinch para pan se sobrou 1 dedo e ainda está com zoom
      if (scale > 1.02) {
        mode = "pan";
        panStartX = e.touches[0].clientX;
        panStartY = e.touches[0].clientY;
        startTx = tx;
        startTy = ty;
      } else {
        mode = "none";
      }
      return;
    }

    if (e.touches.length === 0) {
      const wasPanOrPinch = mode === "pinch";
      mode = "none";

      if (scale <= 1.02) {
        resetZoom(false);
      }

      if (!wasPanOrPinch && !touchMoved && e.changedTouches.length === 1 && !isInteractiveTarget(e.target)) {
        const t = e.changedTouches[0];
        const now = Date.now();
        const dt = now - lastTapAt;
        const dist = Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY);

        if (dt > 0 && dt < 280 && dist < 36) {
          lastTapAt = 0;
          e.preventDefault();
          if (scale > 1.05) {
            resetZoom(true);
          } else {
            zoomAtPoint(t.clientX, t.clientY, doubleTapScale);
            opts.onNotify?.(`🔍 Zoom ${doubleTapScale.toFixed(1)}x (arraste para mover)`);
          }
        } else {
          lastTapAt = now;
          lastTapX = t.clientX;
          lastTapY = t.clientY;
        }
      }
    }
  };

  stageEl.addEventListener("touchstart", onTouchStart, { passive: true });
  stageEl.addEventListener("touchmove", onTouchMove, { passive: false });
  stageEl.addEventListener("touchend", onTouchEnd, { passive: false });
  stageEl.addEventListener("touchcancel", onTouchEnd, { passive: true });

  return {
    getScale: () => scale,
    isCoverMode: () => coverMode,
    setCoverMode,
    toggleCoverMode,
    cycleMobileView,
    resetZoom,
    destroy: () => {
      stageEl.removeEventListener("touchstart", onTouchStart);
      stageEl.removeEventListener("touchmove", onTouchMove);
      stageEl.removeEventListener("touchend", onTouchEnd);
      stageEl.removeEventListener("touchcancel", onTouchEnd);
      stageEl.classList.remove("is-zoomed", "is-zoom-animating", "is-cover-mode");
      videoEl.style.transform = "";
    },
  };
}
