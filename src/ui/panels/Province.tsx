import { RES_ICONS, RES_NAMES } from '../../data/countries';
import { TERRAIN, UNITS } from '../../data/units';
import { BUILDINGS, canConstruct, construct } from '../../sim/economy';
import { RESOURCES } from '../../sim/types';
import { unitVisible } from '../../sim/visibility';
import { WEATHER_FX, weatherOf } from '../../sim/weather';
import { Bar, fmt, NationDot, Sheet } from '../common';
import { useCtl } from '../controller';

export function ProvincePanel() {
  const c = useCtl();
  const g = c.game!;
  const i = c.province;
  const p = g.s.provinces[i];
  const sp = g.w.provs[i];
  const me = g.s.player;
  const owner = g.s.nations[p.owner];
  const ctrl = g.s.nations[p.ctrl];
  const close = () => c.selectProvince(-1);
  const w = WEATHER_FX[weatherOf(g, i)];
  const units = g.unitsAt(i).filter((u) => unitVisible(g, u.owner, u.loc));
  const isCap = owner.capital === i;
  const mine = p.owner === me && p.ctrl === me;
  const resList = RESOURCES.filter((r) => p.dep[r] > 0.05).sort((a, b) => p.dep[b] - p.dep[a]);
  return (
    <Sheet title={<span>{isCap ? '★ ' : ''}{sp.name}</span>} onClose={close}>
      <div class="row wrap small">
        <span class="row"><NationDot color={owner.color} /> {owner.name}</span>
        {p.ctrl !== p.owner && <span class="chip bad">Occupied by {ctrl.name}</span>}
        {p.core !== p.owner && <span class="chip warn">Core of {g.name(p.core)}</span>}
        <span class="chip">{TERRAIN[sp.terrain].name}</span>
        <span class="chip">{w.icon} {w.name}</span>
        {sp.sea.length > 0 && <span class="chip">⚓ Coastal</span>}
        {sp.river.size > 0 && <span class="chip">🌊 River</span>}
      </div>
      <div class="kv" style={{ marginTop: '10px' }}>
        <span>Population</span><b>{fmt.pop(p.pop)}</b>
        <span>Economy</span><b>{fmt.money(p.gdp)}/yr</b>
        {sp.city && <><span>Largest city</span><b>{sp.city}</b></>}
        <span>Infrastructure</span><b>{p.infra.toFixed(1)} / 10</b>
        <span>Fortifications</span><b>{'■'.repeat(p.fort)}{'□'.repeat(5 - p.fort)}</b>
        <span>Supply depot</span><b>{p.depot ? 'Yes' : 'No'}</b>
        {(p.ctrl === me || g.friendly(me, p.ctrl)) && <><span>Supply</span><b>{fmt.pct(g.rt.supply[i])}</b></>}
        {p.dmg > 0.02 && <><span>War damage</span><b class="warn">{fmt.pct(p.dmg)}</b></>}
        {p.rad > 0.02 && <><span>Radiation</span><b class="bad">☢️ {fmt.pct(p.rad)}</b></>}
      </div>
      <div class="small" style={{ marginTop: '8px' }}>Unrest {Math.round(p.unrest)}%{p.rebels > 5 ? ` · rebels ${Math.round(p.rebels)}%` : ''}</div>
      <Bar v={p.unrest / 100} color="#ef4444" />
      {resList.length > 0 && (
        <>
          <div class="section">Resources</div>
          <div class="row wrap">
            {resList.map((r) => <span class="chip">{RES_ICONS[r]} {RES_NAMES[r]} {p.dep[r].toFixed(1)}/day</span>)}
          </div>
        </>
      )}
      <div class="section">Forces here ({units.length})</div>
      <div class="list">
        {units.map((u) => (
          <div class={'item' + (u.owner === me ? ' click' : '')} onClick={() => { if (u.owner === me) { c.select([u.id]); c.selectProvince(-1); } }}>
            <NationDot color={g.s.nations[u.owner].color} />
            <div class="grow">
              <div class="small ellipsis">{u.name} <span class="muted">({g.name(u.owner)})</span></div>
              <Bar v={u.str / 100} color="#22c55e" h={4} />
            </div>
            <b class="tiny">{UNITS[u.type].icon}</b>
          </div>
        ))}
        {!units.length && <div class="muted small">{g.rt.visible[i] ? 'No units.' : 'Hidden by fog of war.'}</div>}
      </div>
      {mine && (
        <>
          <div class="section">Construction</div>
          <div class="list">
            {(['depot', 'fort', 'infra'] as const).map((b) => {
              const err = canConstruct(g, me, b, i);
              return (
                <div class="item">
                  <div class="grow">
                    <div class="small">{BUILDINGS[b].name}</div>
                    <div class="tiny muted">{BUILDINGS[b].desc} {err ? <span class="warn">· {err}</span> : null}</div>
                  </div>
                  <button class="btn sm primary" disabled={!!err} onClick={() => { const e = construct(g, me, b, i); c.toast(e ?? `${BUILDINGS[b].name} ordered`, e ? 'warn' : 'good'); }}>Build</button>
                </div>
              );
            })}
          </div>
        </>
      )}
      {p.ctrl !== me && (
        <button class="btn block" style={{ marginTop: '10px' }} onClick={() => { c.panel = 'diplomacy'; c.panelArg = p.ctrl; c.emit(); }}>
          🤝 Diplomacy with {ctrl.name}
        </button>
      )}
    </Sheet>
  );
}
