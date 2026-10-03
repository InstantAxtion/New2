// Small shared widgets for the Territorial-style UI.
import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { buzz } from '../../platform/mobile';

export function Bar({ v, color, h = 6 }: { v: number; color?: string; h?: number }) {
  return (
    <div class="bar" style={{ height: h + 'px' }}>
      <i style={{ width: Math.max(0, Math.min(100, v * 100)) + '%', background: color }} />
    </div>
  );
}

export function Toggle({ label, on, onChange, desc }: { label: string; on: boolean; onChange: (v: boolean) => void; desc?: string }) {
  return (
    <div class="item click" onClick={() => onChange(!on)}>
      <div class="grow">
        <div>{label}</div>
        {desc && <div class="tiny muted">{desc}</div>}
      </div>
      <div style={{ width: '42px', height: '24px', borderRadius: '12px', background: on ? 'var(--good)' : 'var(--line)', position: 'relative', transition: 'background .15s', flex: 'none' }}>
        <div style={{ position: 'absolute', top: '3px', left: on ? '21px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
      </div>
    </div>
  );
}

export function NationDot({ color }: { color: string }) {
  return <span class="dot" style={{ background: color }} />;
}

export function Help({ children }: { children: ComponentChildren }) {
  return <div class="help">💡 {children}</div>;
}

export function Sheet({ title, onClose, children, tall, right }: { title: ComponentChildren; onClose: () => void; children: ComponentChildren; tall?: boolean; right?: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  // swipe the handle/header down to close
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const down = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (ref.current) ref.current.style.transition = 'none';
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !ref.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    ref.current.style.transform = `translateY(${d.dy}px)`;
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    const el = ref.current;
    if (!d || !el) return;
    const fast = d.dy / Math.max(1, performance.now() - d.t) > 0.6;
    el.style.transition = 'transform .2s ease-out';
    if (d.dy > 90 || (fast && d.dy > 30)) {
      el.style.transform = 'translateY(110%)';
      buzz(8);
      setTimeout(onClose, 160);
    } else el.style.transform = '';
  };
  return (
    <div class={'sheet' + (tall ? ' tall' : '')} ref={ref} onPointerDown={(e) => e.stopPropagation()}>
      <div class="grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}><i /></div>
      <div class="head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <h3 class="ellipsis">{title}</h3>
        {right}
        <button class="btn sm close" onClick={() => { buzz(8); onClose(); }} aria-label="Close">
          ✕
        </button>
      </div>
      <div class="body">{children}</div>
    </div>
  );
}

