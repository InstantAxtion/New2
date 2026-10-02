import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { drawIcon } from '../render/renderer';
import type { Game } from '../sim/ctx';
import type { UnitType } from '../sim/types';
import { buzz } from '../platform/mobile';

export const fmt = {
  money(v: number) {
    const a = Math.abs(v);
    const s = a >= 1000 ? (v / 1000).toFixed(a >= 10000 ? 1 : 2) + 'T' : a >= 10 ? v.toFixed(0) + 'B' : a >= 1 ? v.toFixed(1) + 'B' : (v * 1000).toFixed(0) + 'M';
    return '$' + s;
  },
  num(v: number, d = 0) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e4) return (v / 1e3).toFixed(0) + 'k';
    return v.toFixed(d);
  },
  pop(thousands: number) {
    return thousands >= 1000 ? (thousands / 1000).toFixed(thousands >= 10000 ? 0 : 1) + 'M' : Math.round(thousands) + 'k';
  },
  pct(v: number, d = 0) {
    return (v * 100).toFixed(d) + '%';
  },
  signed(v: number, d = 1) {
    return (v >= 0 ? '+' : '') + v.toFixed(d);
  },
};

export function dateStr(g: Game, day = g.day) {
  const d = g.date(day);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function Bar({ v, color, h = 6 }: { v: number; color?: string; h?: number }) {
  return (
    <div class="bar" style={{ height: h + 'px' }}>
      <i style={{ width: Math.max(0, Math.min(100, v * 100)) + '%', background: color }} />
    </div>
  );
}

export function Stat({ label, value, sub, cls }: { label: string; value: ComponentChildren; sub?: ComponentChildren; cls?: string }) {
  return (
    <div class="stat">
      <div class="l">{label}</div>
      <div class={'v ' + (cls || '')}>{value}</div>
      {sub !== undefined && <div class="tiny muted">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div class="tabs">
      {tabs.map(([id, label]) => (
        <button class={'tab' + (value === id ? ' on' : '')} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
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

export function Slider({ label, value, min, max, step, onInput, display }: { label: string; value: number; min: number; max: number; step: number; onInput: (v: number) => void; display: string }) {
  return (
    <div class="col" style={{ gap: '2px' }}>
      <div class="spread small">
        <span>{label}</span>
        <b>{display}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onInput={(e) => onInput(parseFloat((e.target as HTMLInputElement).value))} />
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

export function Spark({ values, color = '#60a5fa' }: { values: number[]; color?: string }) {
  if (values.length < 2) return <div class="tiny muted">Not enough history yet</div>;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${40 - ((v - min) / span) * 36 - 2}`).join(' ');
  return (
    <svg class="spark" viewBox="0 0 100 40" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

export function NationDot({ color }: { color: string }) {
  return <span class="dot" style={{ background: color }} />;
}

export function relColor(r: number) {
  return r > 50 ? 'var(--good)' : r > 10 ? '#86efac' : r > -10 ? 'var(--muted)' : r > -50 ? '#fca5a5' : 'var(--bad)';
}

/** A row with an icon, a title, a plain-language explanation and an action on the right. */
export function Action({ icon, title, desc, children, onClick, tone }: { icon: string; title: ComponentChildren; desc: ComponentChildren; children?: ComponentChildren; onClick?: () => void; tone?: 'bad' | 'good' }) {
  return (
    <div class={'item action' + (onClick ? ' click' : '') + (tone ? ' ' + tone : '')} onClick={onClick}>
      <span class="aicon">{icon}</span>
      <div class="grow">
        <div class="atitle">{title}</div>
        <div class="tiny muted">{desc}</div>
      </div>
      {children}
    </div>
  );
}

/** Small "will they accept?" indicator for diplomacy. */
export function Likely({ ok }: { ok: boolean }) {
  return <span class={'chip ' + (ok ? 'good' : 'bad')} title={ok ? 'They would likely accept' : 'They would likely refuse'}>{ok ? '✓ likely' : '✗ unlikely'}</span>;
}

export function Help({ children }: { children: ComponentChildren }) {
  return <div class="help">💡 {children}</div>;
}

/** A unit counter like the ones on the map. */
export function UnitIcon({ type, color = '#3b82f6', size = 30 }: { type: UnitType; color?: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = cv.height = size * dpr;
    const x = cv.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, size, size);
    x.fillStyle = color;
    x.beginPath();
    x.arc(size / 2, size / 2, size / 2 - 1.5, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.6)';
    x.lineWidth = 1.5;
    x.stroke();
    x.save();
    x.translate(size / 2, size / 2);
    x.scale(size / 32, size / 32);
    x.fillStyle = '#fff';
    drawIcon(x, type, 0, 0, color);
    x.restore();
  }, [type, color, size]);
  return <canvas ref={ref} style={{ width: size + 'px', height: size + 'px', flex: 'none' }} />;
}

/** "💰 $5B · ⏱ 20d", red when you can't afford it. */
export function Cost({ money, days, have }: { money: number; days?: number; have?: number }) {
  return (
    <span class="cost">
      <span class={have !== undefined && have < money ? 'bad' : ''}>💰{fmt.money(money)}</span>
      {days !== undefined && <span class="muted">⏱{days}d</span>}
    </span>
  );
}

export function HpBar({ hp }: { hp: number }) {
  return (
    <div class="col" style={{ gap: '2px', minWidth: '60px' }}>
      <Bar v={hp / 100} color={hp > 60 ? 'var(--good)' : hp > 30 ? 'var(--warn)' : 'var(--bad)'} h={5} />
    </div>
  );
}
