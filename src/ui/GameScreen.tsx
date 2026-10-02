import { useEffect, useRef, useState } from 'preact/hooks';
import { BUILDINGS, UNITS } from '../data/units';
import { pref } from '../platform/storage';
import type { Layer } from '../render/renderer';
import { declareWar } from '../sim/diplomacy';
import { buildCost } from '../sim/economy';
import { inAirRange, isAir, isLand } from '../sim/military';
import { respondMessage, cededRegions } from '../sim/diplomacy';
import type { Toast, UnitType } from '../sim/types';
import { Cost, dateStr, fmt, NationDot, UnitIcon } from './common';
import { useCtl, type Panel } from './controller';
import { EndScreen } from './EndScreen';
import { ArmyPanel } from './panels/Army';
import { BattlePanel } from './panels/Battle';
import { BuildPanel } from './panels/Build';
import { CountryPanel } from './panels/Country';
import { GameMenu } from './panels/GameMenu';
import { NewsPanel } from './panels/News';
import { ProvincePanel } from './panels/Province';
import { WorldPanel } from './panels/World';
import { Tutorial } from './Tutorial';

const LAYERS: [Layer, string, string][] = [
  ['political', '🗺 Countries', 'Who owns what. Striped = occupied by an enemy.'],
  ['terrain', '⛰ Terrain', 'Mountains, jungle and marsh slow attackers and help defenders.'],
  ['resources', '⛏ Resources', 'Brighter = more resources to dig up. Good places for ⛏ mines.'],
  ['alliances', '🛡 Alliances', 'Military alliances, coloured by alliance.'],
];

export function GameScreen() {
  const c = useCtl();
  const g = c.game!;
  const [showLayers, setShowLayers] = useState(false);
  const [tutorial, setTutorial] = useState(() => !pref('tutorial2Done', false));
  const inbox = g.s.inbox.filter((m) => !m.resolved && m.to === g.s.player).length;
  const tabs: [Panel, string, string, number?][] = [
    ['build', '🔨', 'Build'],
    ['army', '⚔️', 'Army'],
    ['world', '🌍', 'World'],
    ['country', '🏛', 'Country'],
    ['news', '📰', 'News', inbox],
  ];
  useEffect(() => {
    const f = () => setTutorial(true);
    window.addEventListener('show-tutorial', f);
    return () => window.removeEventListener('show-tutorial', f);
  }, []);
  return (
    <>
      <Hud />
      <div class="fabs">
        <button class={'fab' + (showLayers ? ' on' : '')} onClick={() => setShowLayers(!showLayers)} aria-label="Map view">
          🗂<span class="fablabel">View</span>
        </button>
        <button class={'fab' + (c.mode === 'globe' ? ' on' : '')} onClick={() => (c.mode === 'globe' ? c.exitGlobe() : c.enterGlobe())} aria-label="Globe">
          🌐<span class="fablabel">Globe</span>
        </button>
        <button class="fab" onClick={() => c.home()} aria-label="My country">
          🏠<span class="fablabel">Home</span>
        </button>
        <button class="fab" onClick={() => c.selectAll('land')} aria-label="Select all troops">
          🪖<span class="fablabel">All troops</span>
        </button>
      </div>
      {showLayers && (
        <div class="layers">
          {LAYERS.map(([l, label, desc]) => (
            <button class={c.layer === l ? 'on' : ''} onClick={() => { c.setLayer(l); setShowLayers(false); }}>
              <b>{label}</b>
              <div class="tiny" style={{ opacity: 0.8 }}>{desc}</div>
            </button>
          ))}
        </div>
      )}
      <Toasts />
      {c.building && <PlaceBar />}
      {c.selected.size > 0 && !c.panel && !c.building && <SelectionBar />}
      {c.menu && <ContextMenu />}
      {c.panel === 'build' && !c.building && <BuildPanel />}
      {c.panel === 'country' && <CountryPanel />}
      {c.panel === 'army' && <ArmyPanel />}
      {c.panel === 'world' && <WorldPanel />}
      {c.panel === 'news' && <NewsPanel />}
      {c.panel === 'battle' && <BattlePanel />}
      {c.panel === 'province' && c.province >= 0 && <ProvincePanel />}
      {c.panel === 'menu' && <GameMenu />}
      <div class="tabbar">
        {tabs.map(([p, ic, label, badge]) => (
          <button class={c.panel === p || (p === 'build' && c.building) ? 'on' : ''} onClick={() => (p === 'build' && c.building ? c.cancelBuild() : c.open(p))}>
            <span class="ic">{ic}</span>
            {label}
            {badge ? <span class="badge">{badge}</span> : null}
          </button>
        ))}
      </div>
      {c.awayReport && <AwayReport />}
      {!c.awayReport && !g.s.over && c.popup() && <MessagePopup />}
      <Breaking />
      {tutorial && !g.s.over && <Tutorial onDone={() => setTutorial(false)} />}
      {g.s.over && <EndScreen />}
    </>
  );
}

function Hud() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const net = n.income - n.upkeep;
  return (
    <div class="hud">
      <div class="row" style={{ width: '100%' }}>
        <button class="btn sm ghost" style={{ padding: '4px 8px' }} onClick={() => c.open('menu')} aria-label="Menu">☰</button>
        <div class="nation grow" onClick={() => c.open('country')}>
          <NationDot color={n.color} />
          <div class="col" style={{ gap: 0, minWidth: 0 }}>
            <span class="ellipsis">{n.name}</span>
            <span class="date">{dateStr(g)}</span>
          </div>
        </div>
        <div class="speed">
          {[0, 1, 2, 5].map((s) => (
            <button class={c.speed === s ? 'on' : ''} onClick={() => c.setSpeed(s)} aria-label={s === 0 ? 'Pause' : `Speed ${s}`}>
              {s === 0 ? <b style={{ letterSpacing: '-2px' }}>❙❙</b> : s === 1 ? '▶' : s === 2 ? '▶▶' : '▶▶▶'}
            </button>
          ))}
        </div>
      </div>
      <div class="resbar" onClick={() => c.open('country')}>
        <span><b>💰 {fmt.money(n.money)}</b> <i class={net >= 0 ? 'good' : 'bad'}>{net >= 0 ? '+' : ''}{fmt.money(net * 30)} a month</i></span>
        <span>🪖 <b>{g.s.units.reduce((a, u) => a + (u.owner === g.s.player ? 1 : 0), 0)}</b> units</span>
      </div>
    </div>
  );
}

function Toasts() {
  const c = useCtl();
  const g = c.game!;
  const seen = useRef(new Map<number, number>());
  const [, tick] = useState(0);
  const now = performance.now();
  for (const t of g.s.toasts) if (!seen.current.has(t.id)) seen.current.set(t.id, now);
  const show = g.s.toasts.filter((t) => now - (seen.current.get(t.id) ?? 0) < (t.kind === 'danger' ? 7000 : 4500)).slice(-3);
  useEffect(() => {
    if (!show.length) return;
    const id = setTimeout(() => tick((x) => x + 1), 1000);
    return () => clearTimeout(id);
  });
  const last = show[show.length - 1];
  useEffect(() => {
    if (last && last.kind === 'danger' && /declared war on us/i.test(last.text) && pref('autoPauseWar', true) && c.speed > 0) c.setSpeed(0);
  }, [last?.id]);
  return (
    <div class="toasts">
      {show.map((t: Toast) => (
        <div class={'toast ' + t.kind} onClick={() => { if (t.loc !== undefined) c.focus(t.loc); seen.current.set(t.id, -1e9); tick((x) => x + 1); }}>
          {t.text}
          {t.loc !== undefined && <span class="tiny muted"> · tap to see</span>}
        </div>
      ))}
    </div>
  );
}

/** Shown while placing a building. */
function PlaceBar() {
  const c = useCtl();
  const g = c.game!;
  const t = c.building!;
  const d = BUILDINGS[t];
  const cost = buildCost(t, 0);
  const n = c.renderer?.highlight.length ?? 0;
  return (
    <div class="placebar" onPointerDown={(e) => e.stopPropagation()}>
      <div class="row">
        <span style={{ fontSize: '26px' }}>{d.icon}</span>
        <div class="grow">
          <b>Placing: {d.name}</b>
          <div class="tiny">{n ? `Tap a green region (${n} possible).` : 'No region can take one right now.'} <Cost money={cost.money} days={cost.days} have={g.player.money} /></div>
        </div>
        <button class="btn sm" onClick={() => c.open('build')}>Other</button>
        <button class="btn sm primary" onClick={() => c.cancelBuild()}>Done</button>
      </div>
    </div>
  );
}

function SelectionBar() {
  const c = useCtl();
  const g = c.game!;
  const units = c.selectedUnits();
  if (!units.length) return null;
  const n = g.player;
  const byType = new Map<UnitType, number[]>();
  for (const u of units) {
    const l = byType.get(u.type) ?? [];
    l.push(u.id);
    byType.set(u.type, l);
  }
  // other units in the same place, to add back after splitting
  const here = new Set(units.map((u) => (isAir(u) ? u.base : u.loc)));
  const others = g.s.units.filter((u) => u.owner === g.s.player && !c.selected.has(u.id) && here.has(isAir(u) ? u.base : u.loc));
  const hp = units.reduce((a, u) => a + u.hp, 0) / units.length;
  const land = units.some(isLand), air = units.some(isAir);
  const moving = units.some((u) => u.path.length);
  const fighting = units.some((u) => u.path.length && u.path[0] >= 0 && g.rt.battleAt.has(u.path[0]) && u.progress > 0);
  const where = g.locName(air && !land ? units[0].base : units[0].loc);
  const hint = air && !land
    ? 'Tap a region in range to patrol it (fighters) or bomb it (bombers). Tap one of your airbases to move them there.'
    : 'Tap a region — or drag the counter onto it — to move there. Red = attack.';
  const inRange = air && !land ? g.s.provinces.filter((_, i) => units.every((u) => !isAir(u) || inAirRange(g, u, i))).length : 0;
  return (
    <div class="selbar" onPointerDown={(e) => e.stopPropagation()}>
      <div class="spread">
        <div class="grow">
          <b>{units.length === 1 ? UNITS[units[0].type].name : `${units.length} units`}</b> <span class="tiny muted">in {where}{moving ? (fighting ? ' · ⚔ fighting' : ' · on the move') : ''}</span>
          <div class="row tiny muted" style={{ gap: '10px' }}>
            <span>❤️ {Math.round(hp)}%</span>
            {air && !land && <span>📍 {inRange} regions in range</span>}
          </div>
        </div>
        <button class="btn sm ghost" onClick={() => c.clearSelection()} aria-label="Deselect">✕</button>
      </div>
      <div class="chips">
        {[...byType.entries()].map(([t, ids]) => (
          <button class="uchip on" onClick={() => { for (const id of ids) c.toggleUnit(id); }} title="Tap to leave these behind">
            <UnitIcon type={t} color={n.color} size={22} />
            <span>{ids.length}× {UNITS[t].name}</span>
          </button>
        ))}
        {others.length > 0 && (
          <button class="uchip" onClick={() => c.select(others.map((u) => u.id), true)}>➕ {others.length} more here</button>
        )}
      </div>
      <div class="help" style={{ margin: '6px 0 0' }}>👆 {hint}</div>
      <div class="acts">
        {moving && <button class="btn sm" onClick={() => c.stopSelected()}>✋ Stop</button>}
        {land && <button class="btn sm" onClick={() => c.retreatSelected()}>↩ Retreat</button>}
        {land && <button class="btn sm" onClick={() => c.selectProvince(units[0].loc)}>ℹ️ Region</button>}
      </div>
    </div>
  );
}

function ContextMenu() {
  const c = useCtl();
  const g = c.game!;
  const m = c.menu!;
  const me = g.s.player;
  const close = () => c.closeMenu();
  const style = { left: Math.max(8, Math.min(m.x - 120, (c.renderer?.w ?? 400) - 290)) + 'px', top: Math.max(80, Math.min(m.y, (c.renderer?.h ?? 600) - 360)) + 'px' };
  const Item = ({ icon, title, desc, onClick, bad }: { icon: string; title: string; desc: string; onClick: () => void; bad?: boolean }) => (
    <button class={bad ? 'bad' : ''} onClick={() => { onClick(); close(); }}>
      <span style={{ fontSize: '18px', width: '24px' }}>{icon}</span>
      <span class="col" style={{ gap: 0, alignItems: 'flex-start' }}>
        <b>{title}</b>
        <span class="tiny muted">{desc}</span>
      </span>
    </button>
  );
  const loc = m.loc;
  const units = c.selectedUnits();
  const isProv = loc >= 0;
  const p = isProv ? g.s.provinces[loc] : null;
  const ctrl = p ? p.ctrl : -1;
  const enemy = p ? g.atWar(me, ctrl) : false;
  const name = g.locName(loc);
  return (
    <div class="ctxmenu" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div class="ttl">
        {name}
        {p && <div class="tiny muted">{g.name(p.owner)}{p.ctrl !== p.owner ? ` · held by ${g.name(p.ctrl)}` : ''}{enemy ? ' · ENEMY' : ''}</div>}
      </div>
      {units.length > 0 && <Item icon={enemy ? '⚔️' : '➡️'} title={enemy ? 'Attack here' : 'Move here'} desc={`Send your ${units.length} selected unit(s).`} onClick={() => c.issueOrder(loc)} />}
      {isProv && p && p.owner === me && p.ctrl === me && <Item icon="🔨" title="Build here" desc="Mines, factories, barracks, forts…" onClick={() => c.selectProvince(loc)} />}
      {isProv && <Item icon="ℹ️" title="Region details" desc="What it makes, its buildings and who is there." onClick={() => c.selectProvince(loc)} />}
      {isProv && p && ctrl !== me && <Item icon="🤝" title={`Talk to ${g.name(ctrl)}`} desc="Alliances, embargoes or peace." onClick={() => c.open('world', ctrl)} />}
      {isProv && p && ctrl !== me && !g.atWar(me, ctrl) && !g.allied(me, ctrl) && (
        <Item icon="⚔️" title={`Declare war on ${g.name(ctrl)}`} desc="Their allies will join them." bad onClick={() => {
          if (!confirm(`Declare war on ${g.name(ctrl)}?`)) return;
          const e = declareWar(g, me, ctrl);
          if (e) c.toast(e, 'warn');
          c.renderer?.invalidate(true);
        }} />
      )}
    </div>
  );
}

function AwayReport() {
  const c = useCtl();
  return (
    <div class="modal-bg">
      <div class="modal col">
        <h3>⏳ While you were away…</h3>
        <div class="list">
          {c.awayReport!.map((l) => (
            <div class="item small">{l}</div>
          ))}
        </div>
        <button class="btn primary" onClick={() => c.dismissAway()}>Resume command</button>
      </div>
    </div>
  );
}

/** Big headlines slide in at the top for a few seconds. */
function Breaking() {
  const c = useCtl();
  const b = c.breaking;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!b) return;
    const id = setTimeout(() => tick((x) => x + 1), 5600);
    return () => clearTimeout(id);
  }, [b?.at]);
  if (!b || c.panel || performance.now() - b.at > 5500) return null;
  return (
    <div class="breaking" key={b.at} onClick={() => { if (b.loc !== undefined && b.loc >= 0) c.focus(b.loc); c.breaking = null; c.emit(); }}>
      <span class="blabel">BREAKING</span>
      <span class="btext">{b.text}</span>
    </div>
  );
}

/** Offers from other countries pop up so they can't be missed. The game pauses meanwhile. */
function MessagePopup() {
  const c = useCtl();
  const g = c.game!;
  const m = c.popup()!;
  const me = g.s.player;
  const from = g.s.nations[m.from];
  const done = (text: string) => { c.toast(text); c.closePopup(m.id); };
  const surrender = m.kind === 'peace' && m.terms?.kind === 'annex' && m.from !== me;
  const icon = m.kind === 'alliance' ? '🤝' : m.kind === 'nap' ? '🕊️' : m.kind === 'peace' ? (surrender ? '🏳️' : '🕊️') : m.kind === 'join_war' ? '📣' : '📨';
  const title = m.kind === 'alliance' ? 'Alliance offer!' : m.kind === 'nap' ? 'Friendship offer' : surrender ? 'They surrender!' : m.kind === 'peace' ? 'Peace offer' : m.kind === 'join_war' ? 'Your ally needs you!' : 'Message';
  const held = surrender ? cededRegions(g, m.from, me, { kind: 'cede' }).length : 0;
  return (
    <div class="modal-bg" onPointerDown={(e) => e.stopPropagation()}>
      <div class="modal col popup">
        <div class="picon">{icon}</div>
        <h3 class="center">{title}</h3>
        <div class="row" style={{ justifyContent: 'center' }}><NationDot color={from.color} /> <b>{from.name}</b></div>
        <div class="center">{m.text}</div>
        {m.kind === 'alliance' && <div class="tiny muted center">Allies fight together: if one of you is attacked, the other joins in.</div>}
        {m.kind === 'nap' && <div class="tiny muted center">You both promise not to attack each other.</div>}
        {surrender ? (
          <div class="list">
            <button class="btn primary" onClick={() => done(respondMessage(g, m.id, true, { kind: 'annex' }))}>🏴 Take the whole country</button>
            <button class="btn" onClick={() => done(respondMessage(g, m.id, true, { kind: 'cede' }))}>🗺 Keep the {held} region{held === 1 ? '' : 's'} you hold</button>
            <button class="btn" onClick={() => done(respondMessage(g, m.id, true, { kind: 'white' }))}>🕊 Just make peace</button>
          </div>
        ) : (
          <div class="row">
            <button class="btn grow" onClick={() => done(respondMessage(g, m.id, false))}>{m.kind === 'join_war' ? 'Stay out' : 'No thanks'}</button>
            <button class="btn good grow" onClick={() => done(respondMessage(g, m.id, true))}>{m.kind === 'join_war' ? 'Join the war' : 'Accept'}</button>
          </div>
        )}
        <button class="btn sm ghost" onClick={() => c.closePopup(m.id)}>Decide later (in 📰 News)</button>
      </div>
    </div>
  );
}
