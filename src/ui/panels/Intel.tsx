import { useState } from 'preact/hooks';
import { OPS, opCost, recruitSpy, startOp, successChance } from '../../sim/covert';
import type { OpKind } from '../../sim/types';
import { fmt, Sheet } from '../common';
import { useCtl } from '../controller';

export function IntelPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const me = n.idx;
  const close = () => { c.panel = null; c.emit(); };
  const enemies = g.enemies(me);
  const [target, setTarget] = useState<number>(enemies[0] ?? -1);
  const [msg, setMsg] = useState<string | null>(null);
  const ops = g.s.ops.filter((o) => o.owner === me);
  const intel = Object.entries(n.intel).filter(([, d]) => d > g.day);
  const nations = g.s.nations.filter((x) => x.alive && x.active && x.idx !== me).sort((a, b) => (g.atWar(me, b.idx) ? 1 : 0) - (g.atWar(me, a.idx) ? 1 : 0) || a.name.localeCompare(b.name));
  const run = (k: OpKind) => {
    const e = startOp(g, me, target, k);
    setMsg(e ?? `Agents dispatched to ${g.name(target)}.`);
    c.emit();
  };
  return (
    <Sheet title="🕵️ Intelligence" onClose={close} tall>
      <div class="spread">
        <div>
          <b>{n.spies}</b> <span class="muted">agents available</span>
        </div>
        <button class="btn sm" onClick={() => { const e = recruitSpy(g, me); setMsg(e ?? 'New agent recruited.'); c.emit(); }}>
          ➕ Recruit agent ({fmt.money(Math.max(0.1, 0.15 * Math.sqrt(Math.max(1, n.gdp) / 100)))})
        </button>
      </div>
      <div class="section">Target</div>
      <select value={target} onChange={(e) => setTarget(+(e.target as HTMLSelectElement).value)}>
        <option value={-1}>— choose a nation —</option>
        {nations.map((x) => <option value={x.idx}>{g.atWar(me, x.idx) ? '⚔️ ' : ''}{x.name}</option>)}
      </select>
      {msg && <div class="card small" style={{ marginTop: '8px' }}>{msg}</div>}
      {target >= 0 && (
        <div class="list" style={{ marginTop: '10px' }}>
          {OPS.map((o) => {
            const locked = o.cyber && !g.mod(me, 'cyber');
            const p = successChance(g, me, target, o.kind);
            return (
              <div class="item">
                <div class="grow">
                  <div class="small"><b>{o.name}</b></div>
                  <div class="tiny muted">{o.desc}</div>
                  <div class="tiny muted">
                    {o.days} days · {fmt.money(opCost(g, me, o.kind))} · <span class={p > 0.6 ? 'good' : p > 0.35 ? 'warn' : 'bad'}>{fmt.pct(p)} success</span>
                    {locked && <span class="warn"> · needs Cyber Warfare</span>}
                  </div>
                </div>
                <button class="btn sm primary" disabled={locked || n.spies <= 0} onClick={() => run(o.kind)}>Go</button>
              </div>
            );
          })}
        </div>
      )}
      <div class="section">Active operations ({ops.length})</div>
      <div class="list">
        {ops.map((o) => (
          <div class="item small">
            <span class="grow">{OPS.find((x) => x.kind === o.kind)?.name} → {g.name(o.target)}</span>
            <span class="muted">{o.done - g.day}d</span>
          </div>
        ))}
        {!ops.length && <div class="muted small">No operations underway.</div>}
      </div>
      <div class="section">Intel coverage</div>
      <div class="row wrap">
        {intel.map(([k, d]) => <span class="chip good">👁 {g.name(+k)} ({d - g.day}d)</span>)}
        {g.mod(me, 'satellite') > 0 && <span class="chip good">🛰 Satellites: all enemies at war revealed</span>}
        {!intel.length && !g.mod(me, 'satellite') && <span class="muted small">No active intel. Enemy forces outside your sight are hidden.</span>}
      </div>
    </Sheet>
  );
}
