import { RES_NAMES } from '../../data/countries';
import { TERRAIN, UNITS } from '../../data/units';
import { BUILDINGS, canConstruct, construct } from '../../sim/economy';
import { RESOURCES } from '../../sim/types';
import { unitVisible } from '../../sim/visibility';
import { WEATHER_FX, weatherOf } from '../../sim/weather';
import { Action, Bar, fmt, NationDot, Sheet } from '../common';
import { useCtl } from '../controller';

const TERRAIN_NOTE: Record<string, string> = {
  plains: 'Open ground: good for tanks.',
  forest: 'Forest: a bit easier to defend.',
  hills: 'Hills: easier to defend, slower to cross.',
  mountain: 'Mountains: very hard to attack, tanks struggle.',
  desert: 'Desert: hard to keep troops supplied.',
  jungle: 'Jungle: slow, hard to supply, easy to defend.',
  marsh: 'Marsh: slow going, good for defenders.',
  arctic: 'Arctic: freezing, very hard to supply.',
};

export function ProvincePanel() {
  const c = useCtl();
  const g = c.game!;
  const i = c.province;
  const p = g.s.provinces[i];
  const sp = g.w.provs[i];
  const me = g.s.player;
  const owner = g.s.nations[p.owner];
  const ctrl = g.s.nations[p.ctrl];
  const w = WEATHER_FX[weatherOf(g, i)];
  const units = g.unitsAt(i).filter((u) => unitVisible(g, u.owner, u.loc));
  const mine = p.owner === me && p.ctrl === me;
  const res = RESOURCES.filter((r) => p.dep[r] > 1).map((r) => RES_NAMES[r]);
  return (
    <Sheet title={<span>{owner.capital === i ? '★ ' : ''}{sp.name}</span>} onClose={() => c.selectProvince(-1)}>
      <div class="row wrap small">
        <span class="row"><NationDot color={owner.color} /> {owner.name}</span>
        {p.ctrl !== p.owner && <span class="chip bad">Occupied by {ctrl.name}</span>}
        <span class="chip">{w.icon} {w.name}</span>
      </div>
      <div class="tiny muted" style={{ marginTop: '6px' }}>{TERRAIN_NOTE[sp.terrain] ?? TERRAIN[sp.terrain].name}</div>
      <div class="grid3" style={{ marginTop: '8px' }}>
        <div class="stat"><div class="l">People</div><div class="v">{fmt.pop(p.pop)}</div></div>
        <div class="stat"><div class="l">Economy</div><div class="v">{fmt.money(p.gdp)}</div></div>
        <div class="stat"><div class="l">Defenses</div><div class="v">{p.fort ? '🏰'.repeat(Math.min(3, p.fort)) : '—'}</div></div>
      </div>
      {res.length > 0 && <div class="small" style={{ marginTop: '8px' }}>Produces: <b>{res.join(', ')}</b></div>}
      {p.unrest > 30 && (
        <>
          <div class="small" style={{ marginTop: '8px' }}>🔥 Unrest {Math.round(p.unrest)}% — {p.unrest > 70 ? 'rebels may rise up! Station troops here.' : 'people are restless.'}</div>
          <Bar v={p.unrest / 100} color="#ef4444" />
        </>
      )}
      <div class="section">Units here ({units.length})</div>
      <div class="list">
        {units.map((u) => (
          <div class={'item' + (u.owner === me ? ' click' : '')} onClick={() => { if (u.owner === me) { c.select([u.id]); c.selectProvince(-1); } }}>
            <NationDot color={g.s.nations[u.owner].color} />
            <div class="grow">
              <div class="small ellipsis">{u.name} <span class="muted">({g.name(u.owner)})</span></div>
              <Bar v={u.str / 100} color="#22c55e" h={4} />
            </div>
            <span class="tiny muted">{u.owner === me ? 'tap to select' : UNITS[u.type].name.split(' ')[0]}</span>
          </div>
        ))}
        {!units.length && <div class="muted small">{g.rt.visible[i] ? 'No units.' : 'Hidden — you have no eyes here.'}</div>}
      </div>
      {mine && (
        <>
          <div class="section">Build here</div>
          <div class="list">
            {(['depot', 'fort'] as const).map((b) => {
              const err = canConstruct(g, me, b, i);
              return (
                <Action icon={b === 'depot' ? '📦' : '🏰'} title={BUILDINGS[b].name} desc={<>{BUILDINGS[b].desc} {err && <span class="warn">({err})</span>}</>}>
                  <button class="btn sm primary" disabled={!!err} onClick={() => { const e = construct(g, me, b, i); c.toast(e ?? `${BUILDINGS[b].name} ordered`, e ? 'warn' : 'good'); }}>Build</button>
                </Action>
              );
            })}
          </div>
        </>
      )}
      {p.ctrl !== me && (
        <button class="btn block" style={{ marginTop: '10px' }} onClick={() => c.open('world', p.ctrl)}>
          🤝 Talk to {ctrl.name}
        </button>
      )}
    </Sheet>
  );
}
