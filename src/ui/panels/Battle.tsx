import { TERRAIN } from '../../data/units';
import { attackPower, defencePower, isLand, retreat } from '../../sim/military';
import type { Unit } from '../../sim/types';
import { HpBar, NationDot, Sheet, UnitIcon } from '../common';
import { useCtl } from '../controller';

/** One battle: who is fighting, who is winning and why. */
export function BattlePanel() {
  const c = useCtl();
  const g = c.game!;
  const loc = c.panelArg ?? -1;
  const b = g.rt.battleAt.get(loc);
  const me = g.s.player;
  const close = () => c.open(null);
  if (!b) {
    return (
      <Sheet title="⚔️ Battle" onClose={close}>
        <div class="muted">This battle is over.</div>
        {loc >= 0 && <div class="small" style={{ marginTop: '6px' }}>{g.w.provs[loc].name} is held by <b>{g.name(g.s.provinces[loc].ctrl)}</b>.</div>}
      </Sheet>
    );
  }
  const sp = g.w.provs[loc];
  const attackers = g.s.units.filter((u) => isLand(u) && u.path[0] === loc && u.progress > 0);
  const defenders = g.unitsAt(loc).filter((u) => isLand(u) && g.atWar(u.owner, b.att));
  const A = attackers.reduce((a, u) => a + attackPower(g, u, loc, u.loc), 0);
  const D = defenders.reduce((a, u) => a + defencePower(g, u, loc), 0);
  const odds = b.odds;
  const meAtt = g.allied(b.att, me), meDef = g.allied(b.def, me);
  const myOdds = meAtt ? odds : 1 - odds;
  const verdict = myOdds > 0.62 ? 'You are winning' : myOdds < 0.38 ? 'You are losing' : 'Too close to call';
  const fort = g.level(loc, 'fort');
  const reasons: string[] = [];
  if (TERRAIN[sp.terrain].def > 1) reasons.push(`${TERRAIN[sp.terrain].name}: defenders +${Math.round((TERRAIN[sp.terrain].def - 1) * 100)}%`);
  if (fort) reasons.push(`🏰 Fort level ${fort}: defenders +${fort * 30}%`);
  if (attackers.some((u) => u.loc >= 0 && g.w.provs[u.loc].river.has(loc))) reasons.push('🌊 Crossing a river: attackers −25%');
  if (attackers.some((u) => u.loc < 0)) reasons.push('🚢 Landing from the sea: attackers −50%');
  if ([...attackers, ...defenders].some((u) => u.ammo < 0.05)) reasons.push('💥 Some units are out of ammo: −55%');
  if (attackers.some((u) => u.type === 'tank') && TERRAIN[sp.terrain].tank < 1) reasons.push(`🚜 Tanks struggle in ${TERRAIN[sp.terrain].name.toLowerCase()}`);
  reasons.push('🛡 Defenders get +30% (holding ground is easier), more if dug in');
  const hours = g.s.hour - b.start;
  const Side = ({ title, nation, units, power }: { title: string; nation: number; units: Unit[]; power: number }) => (
    <div class="card" style={{ flex: 1, minWidth: 0 }}>
      <div class="row small"><NationDot color={g.s.nations[nation].color} /><b class="ellipsis">{g.name(nation)}</b></div>
      <div class="tiny muted">{title} · power {Math.round(power)}</div>
      <div class="list" style={{ marginTop: '6px' }}>
        {units.map((u) => (
          <div class="row" style={{ gap: '6px' }}>
            <UnitIcon type={u.type} color={g.s.nations[u.owner].color} size={22} />
            <HpBar hp={u.hp} ammo={u.owner === me ? u.ammo : undefined} />
          </div>
        ))}
        {!units.length && <div class="tiny muted">—</div>}
      </div>
    </div>
  );
  return (
    <Sheet title={`⚔️ Battle of ${sp.name}`} onClose={close} tall>
      <div class="tug">
        <i style={{ width: odds * 100 + '%', background: g.s.nations[b.att].color }} />
        <i style={{ width: (1 - odds) * 100 + '%', background: g.s.nations[b.def].color }} />
      </div>
      <div class="spread small" style={{ marginTop: '4px' }}>
        <span>Attack {Math.round(odds * 100)}%</span>
        <b class={meAtt || meDef ? (myOdds > 0.62 ? 'good' : myOdds < 0.38 ? 'bad' : 'warn') : ''}>{meAtt || meDef ? verdict : `${hours < 24 ? hours + ' hours' : Math.floor(hours / 24) + ' days'} of fighting`}</b>
        <span>Defence {Math.round((1 - odds) * 100)}%</span>
      </div>
      <div class="row" style={{ marginTop: '10px', alignItems: 'stretch' }}>
        <Side title="⚔ Attacking" nation={b.att} units={attackers} power={A} />
        <Side title="🛡 Defending" nation={b.def} units={defenders} power={D} />
      </div>
      <div class="tiny muted" style={{ marginTop: '6px' }}>Lost so far: attackers {b.attLost}, defenders {b.defLost} units. Units below ~20% health pull back.</div>
      <div class="section">Why</div>
      <div class="list">{reasons.map((r) => <div class="small">{r}</div>)}</div>
      <div class="help">💡 Tip: attack from several sides, bring artillery next door, send fighters or bombers to this region, and keep factories making ammo.</div>
      <div class="row wrap" style={{ marginTop: '8px' }}>
        {meAtt && <button class="btn sm" onClick={() => { for (const u of attackers.filter((x) => x.owner === me)) retreat(g, u); c.toast('Attack called off'); close(); }}>↩ Call off the attack</button>}
        <button class="btn sm primary" onClick={() => {
          // our idle troops next to the battle
          const near = g.s.units.filter((u) => u.owner === me && isLand(u) && !u.path.length && u.loc >= 0 && (u.loc === loc || sp.nb.includes(u.loc)));
          if (!near.length) { c.toast('No idle troops next to this region.', 'warn'); return; }
          c.select(near.map((u) => u.id));
          c.panel = null;
          c.toast(`${near.length} nearby units selected — tap ${sp.name} to send them in.`);
          c.focus(loc);
        }}>➕ Send nearby troops</button>
        <button class="btn sm" onClick={() => { c.focus(loc); close(); }}>📍 Show on map</button>
      </div>
    </Sheet>
  );
}
