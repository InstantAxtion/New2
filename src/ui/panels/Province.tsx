import { BUILDING_TYPES, BUILDINGS, TERRAIN, UNIT_TYPES, UNITS } from '../../data/units';
import { blockaded, buildCost, canConstruct, canRecruit, cancelConstruction, construct, recruit, recruitCost, regionIncome, regionMaterials, regionUranium, unitAvailable } from '../../sim/economy';
import { unitVisible } from '../../sim/fog';
import type { UnitType } from '../../sim/types';
import { Bar, Cost, fmt, HpBar, NationDot, Sheet, UnitIcon } from '../common';
import { useCtl } from '../controller';

export function ProvincePanel() {
  const c = useCtl();
  const g = c.game!;
  const i = c.province;
  const p = g.s.provinces[i];
  const sp = g.w.provs[i];
  const me = g.s.player;
  const n = g.player;
  const owner = g.s.nations[p.owner];
  const ctrl = g.s.nations[p.ctrl];
  const mine = p.owner === me && p.ctrl === me;
  const seen = g.rt.visible[i] === 1 || mine;
  const units = g.unitsAt(i).filter((u) => unitVisible(g, u.owner, u.loc, u.type) && UNITS[u.type].domain !== 'air');
  const planes = g.s.units.filter((u) => UNITS[u.type].domain === 'air' && u.base === i && (u.owner === me || seen));
  const have = { money: n.money, mat: n.res.materials, uranium: n.res.uranium };
  const trainable = UNIT_TYPES.filter((t) => unitAvailable(g, t) && g.level(i, UNITS[t].needs) > 0);
  const train = (t: UnitType | 'nuke') => {
    const e = recruit(g, me, t, i);
    c.toast(e ?? `${t === 'nuke' ? 'Warhead' : UNITS[t].name} ordered in ${sp.name}`, e ? 'warn' : 'good');
  };
  return (
    <Sheet title={<span>{owner.capital === i ? '★ ' : ''}{sp.name}</span>} onClose={() => c.selectProvince(-1)} tall>
      <div class="row wrap small">
        <span class="row"><NationDot color={owner.color} /> {owner.name}</span>
        {p.ctrl !== p.owner && <span class="chip bad">Held by {ctrl.name}</span>}
        <span class="chip">{TERRAIN[sp.terrain].name}</span>
        {g.rt.battleAt.has(i) && <span class="chip bad" onClick={() => c.open('battle', i)}>⚔️ Battle here</span>}
        {blockaded(g, i) && <span class="chip warn">🚢 Blockaded</span>}
      </div>
      <div class="tiny muted" style={{ marginTop: '4px' }}>{TERRAIN[sp.terrain].note}</div>
      <div class="grid3" style={{ marginTop: '8px' }}>
        <div class="stat"><div class="l">💰 Income</div><div class="v">{fmt.money(regionIncome(g, i) * 30)}</div><div class="tiny muted">a month</div></div>
        <div class="stat"><div class="l">⛏ Materials</div><div class="v">{regionMaterials(g, i).toFixed(1)}</div><div class="tiny muted">a day</div></div>
        <div class="stat"><div class="l">☢ Uranium</div><div class="v">{p.ura > 0 ? (p.b.mine ? regionUranium(g, i).toFixed(1) : 'deposit') : '—'}</div><div class="tiny muted">{p.ura > 0 && !p.b.mine ? 'build a mine' : 'a day'}</div></div>
      </div>
      {p.cap > 0 && p.capBy >= 0 && (
        <div class="card small" style={{ marginTop: '8px' }}>
          🚩 {g.name(p.capBy)} is capturing this region: {Math.round(p.cap * 100)}%
          <Bar v={p.cap} color={g.s.nations[p.capBy].color} />
        </div>
      )}

      {mine && (
        <>
          <div class="section">🔨 Buildings</div>
          {p.build && (
            <div class="item" style={{ marginBottom: '6px' }}>
              <span style={{ fontSize: '22px' }}>{BUILDINGS[p.build.type].icon}</span>
              <div class="grow">
                <div class="small"><b>Building {BUILDINGS[p.build.type].name}</b> · {p.build.days} days left</div>
                <Bar v={1 - p.build.days / p.build.total} color="var(--good)" />
              </div>
              <button class="btn sm" onClick={() => { cancelConstruction(g, i); c.emit(); }}>Cancel</button>
            </div>
          )}
          <div class="list">
            {BUILDING_TYPES.filter((t) => g.year >= BUILDINGS[t].year && (t !== 'nuclear' || g.s.settings.nukes) && (t !== 'port' || sp.sea.length)).map((t) => {
              const d = BUILDINGS[t];
              const lvl = p.b[t] ?? 0;
              const err = canConstruct(g, me, t, i);
              const maxed = lvl >= d.max;
              const cost = buildCost(t, lvl);
              return (
                <div class={'item bitem' + (lvl ? ' have' : '')}>
                  <span class="bicon">{d.icon}</span>
                  <div class="grow">
                    <div class="small"><b>{d.name}</b> {lvl > 0 && <span class="chip good">{d.max > 1 ? `level ${lvl}/${d.max}` : 'built'}</span>}</div>
                    <div class="tiny muted">{d.short}</div>
                    {!maxed && <Cost money={cost.money} mat={cost.mat} days={cost.days} have={have} />}
                  </div>
                  {!maxed && (
                    <button class={'btn sm ' + (err ? '' : 'primary')} disabled={!!err && !/money|materials/.test(err)} onClick={() => { const e = construct(g, me, t, i); c.toast(e ?? `${d.icon} ${d.name} started`, e ? 'warn' : 'good'); }}>
                      {lvl ? 'Upgrade' : 'Build'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {(trainable.length > 0 || g.level(i, 'nuclear') > 0) && (
            <>
              <div class="section">🎖 Train here</div>
              <div class="list">
                {trainable.map((t) => {
                  const rc = recruitCost(t);
                  const err = canRecruit(g, me, t, i);
                  return (
                    <div class="item">
                      <UnitIcon type={t} color={n.color} size={30} />
                      <div class="grow">
                        <div class="small"><b>{UNITS[t].name}</b></div>
                        <Cost money={rc.money} mat={rc.mat} days={rc.days} have={have} />
                      </div>
                      <button class="btn sm primary" disabled={!!err} onClick={() => train(t)}>Train</button>
                    </div>
                  );
                })}
                {g.level(i, 'nuclear') > 0 && (
                  <div class="item">
                    <span style={{ fontSize: '22px' }}>☢️</span>
                    <div class="grow">
                      <div class="small"><b>Nuclear warhead</b></div>
                      <Cost money={recruitCost('nuke').money} uranium={recruitCost('nuke').uranium} days={recruitCost('nuke').days} have={have} />
                    </div>
                    <button class="btn sm danger" disabled={!!canRecruit(g, me, 'nuke', i)} onClick={() => train('nuke')}>Build</button>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
      {!mine && seen && BUILDING_TYPES.some((t) => p.b[t]) && (
        <>
          <div class="section">🏗 Their buildings</div>
          <div class="row wrap">{BUILDING_TYPES.filter((t) => p.b[t]).map((t) => <span class="chip">{BUILDINGS[t].icon} {BUILDINGS[t].name}{(p.b[t] ?? 0) > 1 ? ` ${p.b[t]}` : ''}</span>)}</div>
        </>
      )}

      <div class="section">🎖 Units here ({units.length + planes.length})</div>
      <div class="list">
        {[...units, ...planes].map((u) => (
          <div class={'item' + (u.owner === me ? ' click' : '')} onClick={() => { if (u.owner === me) { c.select([u.id]); c.selectProvince(-1); } }}>
            <UnitIcon type={u.type} color={g.s.nations[u.owner].color} size={26} />
            <div class="grow">
              <div class="small ellipsis">{UNITS[u.type].name} <span class="muted">({g.name(u.owner)})</span></div>
              <HpBar hp={u.hp} ammo={u.owner === me ? u.ammo : undefined} />
            </div>
            {u.owner === me && <span class="tiny muted">select</span>}
          </div>
        ))}
        {!units.length && !planes.length && <div class="muted small">{seen ? 'No units.' : '🌫 Hidden by fog of war — move troops nearby to see.'}</div>}
      </div>
      {p.ctrl !== me && (
        <button class="btn block" style={{ marginTop: '10px' }} onClick={() => c.open('world', p.ctrl)}>🤝 Talk to {ctrl.name}</button>
      )}
    </Sheet>
  );
}
