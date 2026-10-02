// Touch/mouse gestures: pan, pinch-zoom, tap, long-press, and freehand drawing.
export interface GestureHandlers {
  pan(dx: number, dy: number): void;
  zoom(sx: number, sy: number, factor: number): void;
  tap(sx: number, sy: number): void;
  doubleTap(sx: number, sy: number): void;
  longPress(sx: number, sy: number): void;
  drawStart?(sx: number, sy: number): void;
  drawMove?(sx: number, sy: number): void;
  drawEnd?(): void;
  isDrawing(): boolean;
  gestureEnd?(): void;
}

export function attachGestures(el: HTMLElement, h: GestureHandlers) {
  const pts = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  let moved = false;
  let longTimer: number | null = null;
  let lastTap = 0;
  let pinchDist = 0;
  let drawing = false;
  const rel = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as [number, number];
  };
  const clearLong = () => {
    if (longTimer !== null) { clearTimeout(longTimer); longTimer = null; }
  };

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    const [x, y] = rel(e);
    pts.set(e.pointerId, { x, y, sx: x, sy: y, t: performance.now() });
    if (pts.size === 1) {
      moved = false;
      if (h.isDrawing()) {
        drawing = true;
        h.drawStart?.(x, y);
        return;
      }
      clearLong();
      longTimer = window.setTimeout(() => {
        longTimer = null;
        if (!moved && pts.size === 1) {
          moved = true; // suppress tap
          h.longPress(x, y);
        }
      }, 480);
    } else if (pts.size === 2) {
      clearLong();
      if (drawing) { drawing = false; h.drawEnd?.(); }
      const [a, b] = [...pts.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      moved = true;
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const [x, y] = rel(e);
    const dx = x - p.x, dy = y - p.y;
    p.x = x;
    p.y = y;
    if (Math.hypot(x - p.sx, y - p.sy) > 8) { moved = true; clearLong(); }
    if (drawing) { h.drawMove?.(x, y); return; }
    if (pts.size === 1) {
      if (moved) h.pan(dx, dy);
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (pinchDist > 0) h.zoom(mx, my, d / pinchDist);
      pinchDist = d;
      h.pan(dx / 2, dy / 2);
    }
  });

  const end = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    clearLong();
    if (drawing && pts.size === 0) {
      drawing = false;
      h.drawEnd?.();
      return;
    }
    if (!p) return;
    if (pts.size === 0) {
      if (!moved && e.type === 'pointerup') {
        const now = performance.now();
        if (now - lastTap < 300) {
          h.doubleTap(p.x, p.y);
          lastTap = 0;
        } else {
          lastTap = now;
          h.tap(p.x, p.y);
        }
      }
      h.gestureEnd?.();
    }
    if (pts.size < 2) pinchDist = 0;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = rel(e);
    h.zoom(x, y, Math.exp(-e.deltaY * 0.0015));
    h.gestureEnd?.();
  }, { passive: false });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const [x, y] = rel(e as unknown as PointerEvent);
    h.longPress(x, y);
  });
}
