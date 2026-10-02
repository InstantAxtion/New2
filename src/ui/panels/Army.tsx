import { UNIT_TYPES, UNITS } from '../../data/units';
import { canRecruit, cancelRecruit, queuePosition, recruit, trainingSites, unitAvailable } from '../../sim/economy';
import type { Domain, UnitType } from '../../sim/types';
import { Bar, Cost, fmt, Help, Sheet, UnitIcon } from '../common';
import { useCtl } from '../controller';

const LABEL: Record<Domain, string> = { land: '🪖 Troops', air: '✈️ Planes', sea: '⚓ Ships' };

export function ArmyPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const me = g.s.player;
  const units = g.unitsOf(me);
  const count = (d: Domain) => units.filter((u) => UNITS[u.type].domain === d).length;
  const hurt = units.filter((u) => u.hp < 50).length;
  return (
    <Sheet title="⚔️ Army" onClose={() => c.open(null)} tall>
      <div class="grid3">
        {(['land', 'air', 'sea'] as Domain[]).map((d) => (
          <button class="stat" style={{ textAlign: 'left' }} onClick={() => { c.panel = null; c.selectAll(d); }}>
            <div class="l">{LABEL[d]}</div>
            <div class="v">{count(d)}</div>
            <div class="tiny muted">tap: select all</div>
          </button>
        ))}
      </div>
      <div class="row wrap small" style={{ marginTop: '8px' }}>
        <span>Upkeep: <b>{fmt.money(n.upkeep * 30)}</b>/month</span>
        {hurt > 0 && <span class="warn">❤️ {hurt} badly hurt (they heal at home)</span>}
      </div>

      {n.queue.length > 0 && (
        <>
          <div class="section">🏭 Training ({n.queue.length})</div>
          <div class="list">
            {n.queue.map((q) => {
              const pos = queuePosition(g, n, q);
              return (
                <div class="item">
                  <UnitIcon type={q.type} color={n.color} size={26} />
                  <div class="grow">
                    <div class="small">{UNITS[q.type].name} <span class="tiny muted">· {g.w.provs[q.at].name}</span></div>
                    <Bar v={pos ? 0 : 1 - q.days / q.total} color="var(--good)" />
                    <div class="tiny muted">{pos ? `waiting (#${pos} in line — upgrade the building to train more at once)` : `${q.days} days left`}</div>
                  </div>
                  <button class="btn sm" aria-label="Cancel" onClick={() => { cancelRecruit(g, me, q.id); c.emit(); }}>✕</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div class="section">➕ Train new units</div>
      <Help>Troops train at a 🪖 Barracks, planes at an ✈️ Airbase, ships at a ⚓ Port. New units appear there.</Help>
      <div class="list">
        {UNIT_TYPES.filter((t) => unitAvailable(g, t)).map((t: UnitType) => {
          const d = UNITS[t];
          const err = canRecruit(g, me, t);
          const sites = trainingSites(g, me, t).length;
          return (
            <div class="item">
              <UnitIcon type={t} color={n.color} size={36} />
              <div class="grow">
                <div class="spread"><b class="small">{d.name}</b><span class="tiny muted">⚔{d.atk || d.sea} 🛡{d.def || '–'}{d.aa ? ` ✈${d.aa}` : ''}</span></div>
                <div class="tiny muted">{d.role}</div>
                <Cost money={d.cost} days={d.days} have={n.money} />
                {!sites && <div class="tiny warn">Needs a {d.needs === 'barracks' ? '🪖 Barracks' : d.needs === 'airbase' ? '✈️ Airbase' : '⚓ Port'}</div>}
              </div>
              <button class="btn sm primary" disabled={!!err} onClick={() => { const e = recruit(g, me, t); c.toast(e ?? `${d.name} ordered`, e ? 'warn' : 'good'); }}>Train</button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
