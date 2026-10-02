import { BUILDING_TYPES, BUILDINGS } from '../../data/units';
import { buildCost, cancelConstruction } from '../../sim/economy';
import { Bar, Cost, Help, Sheet } from '../common';
import { useCtl } from '../controller';

/** Pick a building, then tap where it goes on the map. */
export function BuildPanel() {
  const c = useCtl();
  const g = c.game!;
  const me = g.s.player;
  const n = g.player;
  const mine = g.s.provinces.map((p, i) => ({ p, i })).filter(({ p }) => p.owner === me && p.ctrl === me);
  const total = (t: (typeof BUILDING_TYPES)[number]) => mine.reduce((a, { p }) => a + (p.b[t] ?? 0), 0);
  const building = mine.filter(({ p }) => p.build);
  const types = BUILDING_TYPES.filter((t) => g.year >= BUILDINGS[t].year);
  return (
    <Sheet title="🔨 Build" onClose={() => c.open(null)} tall>
      <Help>Pick a building, then tap a <b class="good">green</b> region on the map. Each region builds one thing at a time. Everything costs just 💰 money.</Help>
      <div class="bgrid">
        {types.map((t) => {
          const d = BUILDINGS[t];
          const cost = buildCost(t, 0);
          return (
            <button class={'bcard' + (n.money >= cost.money ? '' : ' dim')} onClick={() => c.startBuild(t)}>
              <div class="spread">
                <span class="bicon">{d.icon}</span>
                <span class="tiny muted">you have {total(t)}</span>
              </div>
              <b>{d.name}</b>
              <div class="tiny muted bdesc">{d.short}</div>
              <Cost money={cost.money} days={cost.days} have={n.money} />
              {d.max > 1 && <div class="tiny muted">up to level {d.max}</div>}
            </button>
          );
        })}
      </div>
      <div class="section">🚧 Under construction ({building.length})</div>
      {!building.length && <div class="small muted">Nothing is being built.</div>}
      <div class="list">
        {building.map(({ p, i }) => {
          const b = p.build!;
          const lvl = (p.b[b.type] ?? 0) + 1;
          return (
            <div class="item click" onClick={() => { c.focus(i); c.selectProvince(i); }}>
              <span style={{ fontSize: '22px' }}>{BUILDINGS[b.type].icon}</span>
              <div class="grow">
                <div class="small"><b>{BUILDINGS[b.type].name}{BUILDINGS[b.type].max > 1 ? ` (level ${lvl})` : ''}</b> · {g.w.provs[i].name}</div>
                <Bar v={1 - b.days / b.total} color="var(--good)" />
                <div class="tiny muted">{b.days} days left</div>
              </div>
              <button class="btn sm" onClick={(e) => { e.stopPropagation(); cancelConstruction(g, i); c.emit(); }} aria-label="Cancel">✕</button>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
