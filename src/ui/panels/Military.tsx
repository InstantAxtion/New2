import { useState } from 'preact/hooks';
import { TRAITS } from '../../data/names';
import { UNITS, UNIT_TYPES, NUKE_URANIUM } from '../../data/units';
import { canBuild, enqueue, nationCostLevel, unitCost } from '../../sim/economy';
import { assignGeneral } from '../../sim/military';
import { defconName, setArmed } from '../../sim/nuclear';
import { addGeneral } from '../../sim/setup';
import type { Domain, UnitType } from '../../sim/types';
import { Bar, fmt, Sheet, Stat, Tabs } from '../common';
import { useCtl } from '../controller';

type Tab = 'units' | 'build' | 'generals' | 'nuclear';

export function MilitaryPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const initial: Tab = c.panelArg === 2 ? 'generals' : 'units';
  const [tab, setTab] = useState<Tab>(initial);
  const [filter, setFilter] = useState<Domain>('land');
  const close = () => { c.panel = null; c.panelArg = null; c.emit(); };
  const units = g.unitsOf(n.idx);
  return (
    <Sheet title="⚔️ Military" onClose={close} tall>
      <div class="grid3">
        <Stat label="Units" value={units.length} sub={`${units.filter((u) => UNITS[u.type].domain === 'land').length} land · ${units.filter((u) => UNITS[u.type].domain === 'air').length} air · ${units.filter((u) => UNITS[u.type].domain === 'sea').length} sea`} />
        <Stat label="Manpower" value={fmt.num(n.manpower) + 'k'} sub={n.conscription} />
        <Stat label="Readiness" value={fmt.pct(n.readiness)} cls={n.readiness < 0.8 ? 'bad' : ''} sub="upkeep funded" />
      </div>
      <div style={{ margin: '10px 0' }}>
        <Tabs<Tab> tabs={[['units', 'Forces'], ['build', 'Production'], ['generals', 'Generals'], ['nuclear', '☢️ Nuclear']]} value={tab} onChange={setTab} />
      </div>
      {tab === 'units' && (
        <>
          <div class="row" style={{ marginBottom: '8px' }}>
            {(['land', 'air', 'sea'] as Domain[]).map((d) => (
              <button class={'btn sm grow' + (filter === d ? ' on' : '')} onClick={() => setFilter(d)}>
                {d === 'land' ? '🪖 Army' : d === 'air' ? '✈️ Air' : '⚓ Navy'}
              </button>
            ))}
          </div>
          <div class="row" style={{ marginBottom: '8px' }}>
            <button class="btn sm grow" onClick={() => { c.select(units.filter((u) => UNITS[u.type].domain === filter).map((u) => u.id)); close(); }}>
              Select all {filter}
            </button>
            <button class="btn sm grow" onClick={() => { c.select(units.filter((u) => UNITS[u.type].domain === filter && !u.path.length).map((u) => u.id)); close(); }}>
              Select idle
            </button>
          </div>
          <div class="list">
            {units.filter((u) => UNITS[u.type].domain === filter).map((u) => (
              <div class={'item click' + (c.selected.has(u.id) ? ' card sel' : '')} onClick={() => { c.select([u.id]); c.focus(u.loc); close(); }}>
                <b style={{ width: '34px', fontSize: '11px' }}>{UNITS[u.type].icon}</b>
                <div class="grow">
                  <div class="ellipsis small">{u.name}</div>
                  <div class="tiny muted ellipsis">
                    📍 {g.locName(u.loc)}
                    {u.path.length ? ` → ${g.locName(u.path[u.path.length - 1])}` : ''}
                    {UNITS[u.type].domain === 'air' && u.mission !== 'idle' ? ` · ${u.mission} @ ${g.locName(u.target)}` : ''}
                    {UNITS[u.type].domain === 'sea' && u.mission !== 'idle' ? ` · ${u.mission}` : ''}
                    {u.supply < 0.35 && UNITS[u.type].domain === 'land' ? ' · ⚠️ low supply' : ''}
                  </div>
                  <div class="row" style={{ gap: '4px' }}>
                    <div class="grow"><Bar v={u.str / 100} color="#22c55e" h={4} /></div>
                    <div class="grow"><Bar v={u.org / 100} color="#60a5fa" h={4} /></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'build' && <Production />}
      {tab === 'generals' && <Generals />}
      {tab === 'nuclear' && <Nuclear />}
    </Sheet>
  );
}

function Production() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  return (
    <>
      <div class="section">Queue ({n.queue.length})</div>
      {!n.queue.length && <div class="muted small">Nothing in production. Raise the military budget to fund new units.</div>}
      <div class="list">
        {n.queue.map((q) => (
          <div class="item">
            <div class="grow">
              <div class="small">
                {q.type === 'nuke' ? '☢️ Nuclear warhead' : q.type === 'depot' ? '🏗 Supply depot' : q.type === 'fort' ? '🏗 Fortification' : q.type === 'infra' ? '🏗 Infrastructure' : UNITS[q.type as UnitType].name}
                <span class="tiny muted"> · {g.locName(q.at)}</span>
              </div>
              <Bar v={q.progress / q.cost} />
              <div class="tiny muted">{fmt.money(q.progress)} / {fmt.money(q.cost)} · {q.days > 0 ? `${q.days} days min.` : 'awaiting funds'}</div>
            </div>
            <button class="btn sm" onClick={() => { n.queue = n.queue.filter((x) => x !== q); n.treasury += q.progress * 0.5; c.emit(); }}>✕</button>
          </div>
        ))}
      </div>
      <div class="section">Build (cost level ×{nationCostLevel(g, n).toFixed(2)})</div>
      <div class="list">
        {UNIT_TYPES.map((t) => {
          const def = UNITS[t];
          const err = canBuild(g, n.idx, t);
          return (
            <div class="item">
              <b style={{ width: '34px', fontSize: '11px' }}>{def.icon}</b>
              <div class="grow">
                <div class="small">{def.name}</div>
                <div class="tiny muted">
                  {fmt.money(unitCost(g, n, t))} · {def.days}d · {def.manpower}k men
                  {err ? <span class="warn"> · {err}</span> : null}
                </div>
              </div>
              <button class="btn sm primary" disabled={!!err} onClick={() => { const e = enqueue(g, n.idx, t); if (e) c.toast(e, 'warn'); c.emit(); }}>
                Build
              </button>
            </div>
          );
        })}
      </div>
      <div class="tiny muted" style={{ marginTop: '6px' }}>New units appear at your capital (ships at your largest port). Build depots, forts and infrastructure by long-pressing your provinces.</div>
    </>
  );
}

function Generals() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const gens = g.s.generals.filter((x) => x.owner === n.idx && x.alive);
  const sel = c.selectedUnits();
  const cost = Math.max(0.2, n.gdp * 0.0003);
  return (
    <>
      {sel.length > 0 ? <div class="small">Assign a commander to the {sel.length} selected unit(s):</div> : <div class="small muted">Select units on the map, then assign a general here.</div>}
      <div class="list" style={{ marginTop: '8px' }}>
        {gens.map((gen) => {
          const led = g.s.units.filter((u) => u.gen === gen.id).length;
          return (
            <div class="item">
              <div class="grow">
                <div>
                  <b>{gen.name}</b> <span class="gold">{'★'.repeat(gen.skill)}</span>
                </div>
                <div class="tiny muted">{gen.traits.map((t) => TRAITS.find((x) => x.id === t)?.name + ' (' + TRAITS.find((x) => x.id === t)?.desc + ')').join(' · ')}</div>
                <div class="tiny muted">Commands {led} units</div>
              </div>
              <button class="btn sm primary" disabled={!sel.length} onClick={() => { assignGeneral(g, sel, gen.id); c.toast(`${gen.name} now commands ${sel.length} units`, 'good'); }}>
                Assign
              </button>
            </div>
          );
        })}
      </div>
      <button
        class="btn block"
        style={{ marginTop: '10px' }}
        onClick={() => {
          if (n.treasury < cost) { c.toast('Not enough money', 'warn'); return; }
          n.treasury -= cost;
          const gen = addGeneral(g, n.idx, false);
          c.toast(`${gen.name} joins the general staff`, 'good');
        }}
      >
        🎖 Promote a new general ({fmt.money(cost)})
      </button>
    </>
  );
}

function Nuclear() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  if (!g.s.settings.nukes) return <div class="muted">Nuclear weapons are disabled in this game.</div>;
  const canBuildNuke = canBuild(g, n.idx, 'nuke');
  return (
    <div class="col">
      <div class={'card'} style={{ borderColor: g.s.defcon <= 2 ? 'var(--bad)' : 'var(--line)' }}>
        <div class="big">{defconName(g.s.defcon)}</div>
        <div class="small muted">World nuclear readiness. Arming warheads, nuclear powers at war and launches all raise it.</div>
      </div>
      <div class="grid2">
        <Stat label="Warheads" value={n.nukes} />
        <Stat label="Status" value={n.nukesArmed ? 'ARMED' : 'Safe'} cls={n.nukesArmed ? 'bad' : 'good'} />
      </div>
      <button class={'btn ' + (n.nukesArmed ? '' : 'danger')} disabled={!n.nukes && !n.nukesArmed} onClick={() => { const e = setArmed(g, n.idx, !n.nukesArmed); if (e) c.toast(e, 'warn'); c.emit(); }}>
        {n.nukesArmed ? '🔓 Stand down nuclear forces' : '☢️ Arm nuclear forces'}
      </button>
      <button class="btn" disabled={!!canBuildNuke} onClick={() => { const e = enqueue(g, n.idx, 'nuke'); c.toast(e ?? 'Warhead production started', e ? 'warn' : 'good'); }}>
        🏭 Build warhead ({fmt.money(unitCost(g, n, 'nuke'))}, {NUKE_URANIUM} uranium)
      </button>
      {canBuildNuke && <div class="tiny warn">{canBuildNuke}</div>}
      <div class="tiny muted">
        To launch: arm your forces, then long-press an enemy province and choose ☢️ Nuclear strike. Without ICBMs you need bombers, missile batteries or (with nuclear subs) submarines in range. Missile shields can intercept. Every nation on Earth will turn against you, markets will crash and the victim may retaliate.
      </div>
      <div class="section">Nuclear powers</div>
      <div class="list">
        {g.s.nations.filter((x) => x.alive && x.nukes > 0).sort((a, b) => b.nukes - a.nukes).map((x) => (
          <div class="item small">
            <span class="grow">{x.name}</span>
            <b>{x.nukes}</b>
            {x.nukesArmed && <span class="chip bad">ARMED</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
