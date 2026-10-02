import type { ComponentChildren } from 'preact';
import type { Game } from '../sim/ctx';

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
  return (
    <div class={'sheet' + (tall ? ' tall' : '')} onPointerDown={(e) => e.stopPropagation()}>
      <div class="head">
        <h3 class="ellipsis">{title}</h3>
        {right}
        <button class="btn sm ghost" onClick={onClose} aria-label="Close">
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
