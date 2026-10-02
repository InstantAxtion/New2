import { useEffect, useRef, useState } from 'preact/hooks';
import { UNITS } from '../data/units';
import { pref } from '../platform/storage';
import type { Layer } from '../render/renderer';
import { declareWar } from '../sim/diplomacy';
import { BUILDINGS, construct } from '../sim/economy';
import { defconName, launchNuke, nukeRangeOk } from '../sim/nuclear';
import type { Toast } from '../sim/types';
import { councilName, playerVote, RES_INFO } from '../sim/un';
import { dateStr, fmt, NationDot } from './common';
import { useCtl, type Panel } from './controller';
import { EndScreen } from './EndScreen';
import { ArmyPanel } from './panels/Army';
import { CountryPanel } from './panels/Country';
import { GameMenu } from './panels/GameMenu';
import { NewsPanel } from './panels/News';
import { ProvincePanel } from './panels/Province';
import { WorldPanel } from './panels/World';
import { Tutorial } from './Tutorial';

const LAYERS: [Layer, string, string][] = [
  ['political', '🗺 Countries', 'Who owns what. Striped = occupied by an enemy.'],
  ['terrain', '⛰ Terrain', 'Mountains, jungle and marsh slow attackers and help defenders.'],
  ['supply', '📦 Supply', 'Green = your troops are well supplied. Red = they will weaken.'],
  ['alliances', '🛡 Alliances', 'Military alliances, coloured by bloc.'],
  ['weather', '🌦 Weather', 'Snow, monsoon and storms slow armies and ground planes.'],
];

export function GameScreen() {
  const c = useCtl();
  const g = c.game!;
  const [showLayers, setShowLayers] = useState(false);
  const [tutorial, setTutorial] = useState(() => !pref('tutorialDone', false));
  const inbox = g.s.inbox.filter((m) => !m.resolved && m.to === g.s.player).length + (g.s.un.res.some((r) => !r.resolved) ? 1 : 0);
  const tabs: [Panel, string, string, number?][] = [
    ['country', '🏛', 'Country'],
    ['army', '⚔️', 'Army'],
    ['world', '🌍', 'World', inbox],
    ['news', '📰', 'News'],
  ];
  useEffect(() => {
    const f = () => setTutorial(true);
    window.addEventListener('show-tutorial', f);
    return () => window.removeEventListener('show-tutorial', f);
  }, []);
  return (
    <>
      <Hud />
      {pref('ticker', true) && <Ticker />}
      <div class="fabs">
        <button class={'fab' + (showLayers ? ' on' : '')} onClick={() => setShowLayers(!showLayers)} aria-label="Map view">
          🗂
          <span class="fablabel">View</span>
        </button>
        <button class={'fab' + (c.mode === 'globe' ? ' on' : '')} onClick={() => (c.mode === 'globe' ? c.exitGlobe() : c.enterGlobe())} aria-label="Globe">
          🌐
          <span class="fablabel">Globe</span>
        </button>
        <button class="fab" onClick={() => { const cap = g.player.capital; if (cap >= 0) c.focus(cap); }} aria-label="My country">
          🏠
          <span class="fablabel">Home</span>
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
      {c.tool === 'frontline' && !c.menu && (
        <div class="unbanner">
          <div class="toast warn">✏️ Drag your finger across the provinces where you want your front line. Use two fingers to move the map.</div>
        </div>
      )}
      <Toasts />
      {c.selected.size > 0 && !c.panel && <SelectionBar />}
      {c.menu && <ContextMenu />}
      {c.panel === 'country' && <CountryPanel />}
      {c.panel === 'army' && <ArmyPanel />}
      {c.panel === 'world' && <WorldPanel />}
      {c.panel === 'news' && <NewsPanel />}
      {c.panel === 'province' && c.province >= 0 && <ProvincePanel />}
      {c.panel === 'menu' && <GameMenu />}
      <div class="tabbar">
        {tabs.map(([p, ic, label, badge]) => (
          <button class={c.panel === p ? 'on' : ''} onClick={() => c.open(p)}>
            <span class="ic">{ic}</span>
            {label}
            {badge ? <span class="badge">{badge}</span> : null}
          </button>
        ))}
      </div>
      {c.awayReport && <AwayReport />}
      {tutorial && !g.s.over && <Tutorial onDone={() => setTutorial(false)} />}
      {g.s.over && <EndScreen />}
    </>
  );
}

function Hud() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const bal = n.income + n.tradeIncome - n.expense;
  return (
    <div class="hud">
      <div class="row" style={{ width: '100%' }}>
        <button class="btn sm ghost" style={{ padding: '4px 8px' }} onClick={() => c.open('menu')} aria-label="Menu">
          ☰
        </button>
        <div class="nation grow" onClick={() => c.open('country')}>
          <NationDot color={n.color} />
          <div class="col" style={{ gap: 0, minWidth: 0 }}>
            <span class="ellipsis">{n.name}</span>
            <span class="date">{dateStr(g)}{g.s.defcon <= 3 && <span class={'defcon d' + g.s.defcon} style={{ marginLeft: '6px' }} title={defconName(g.s.defcon)}>DEFCON {g.s.defcon}</span>}</span>
          </div>
        </div>
        <div class="money" onClick={() => c.open('country')}>
          <b>{fmt.money(n.treasury)}</b>
          <span class={bal >= 0 ? 'good' : 'bad'}>{bal >= 0 ? '+' : ''}{fmt.money(bal * 30)}/mo</span>
        </div>
        <div class="speed">
          {[0, 1, 2, 5].map((s) => (
            <button class={c.speed === s ? 'on' : ''} onClick={() => c.setSpeed(s)} aria-label={s === 0 ? 'Pause' : `Speed ${s}`}>
              {s === 0 ? <b style={{ letterSpacing: '-2px' }}>❙❙</b> : s === 1 ? '▶' : s === 2 ? '▶▶' : '▶▶▶'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Ticker() {
  const c = useCtl();
  const g = c.game!;
  const items = g.s.news.slice(-8).reverse();
  const text = items.map((n) => n.text).join('   •   ');
  const key = items[0]?.text ?? '';
  return (
    <div class="ticker" onClick={() => c.open('news')}>
      <div class="label">NEWS</div>
      <div style={{ overflow: 'hidden', flex: 1 }}>
        <span class="track" key={key} style={{ animationDuration: Math.max(20, text.length / 7) + 's' }}>
          {text || 'The world awaits your decisions…'}
        </span>
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
  const show = g.s.toasts.filter((t) => now - (seen.current.get(t.id) ?? 0) < (t.kind === 'danger' ? 8000 : 5000)).slice(-3);
  useEffect(() => {
    if (!show.length) return;
    const id = setTimeout(() => tick((x) => x + 1), 1000);
    return () => clearTimeout(id);
  });
  const last = show[show.length - 1];
  useEffect(() => {
    if (last && last.kind === 'danger' && /declared war on us|nuclear/i.test(last.text) && pref('autoPauseWar', true) && c.speed > 0) c.setSpeed(0);
  }, [last?.id]);
  return (
    <div class="toasts" style={{ top: pref('ticker', true) ? undefined : 'calc(58px + var(--safe-top))' }}>
      {show.map((t: Toast) => (
        <div class={'toast ' + t.kind} onClick={() => { if (t.loc !== undefined) c.focus(t.loc); seen.current.set(t.id, -1e9); tick((x) => x + 1); }}>
          {t.text}
          {t.loc !== undefined && <span class="tiny muted"> · tap to see</span>}
        </div>
      ))}
      <UnBanner />
    </div>
  );
}

function UnBanner() {
  const c = useCtl();
  const g = c.game!;
  const r = g.s.un.res.find((x) => !x.resolved);
  const [hidden, setHidden] = useState<number | null>(null);
  if (!r || hidden === r.id) return null;
  const me = g.s.player;
  const voted = r.yes.includes(me) ? 'yes' : r.no.includes(me) ? 'no' : r.abstain.includes(me) ? 'abstain' : null;
  const what = r.kind === 'peacekeep' ? g.s.wars.find((w) => w.id === r.target)?.name ?? 'war' : g.name(r.target);
  return (
    <div class="toast" style={{ borderLeftColor: '#60a5fa' }}>
      <div class="spread">
        <b>🏛 {councilName(g)} vote: {RES_INFO[r.kind].name} — {what}</b>
        <button class="btn sm ghost" onClick={() => setHidden(r.id)}>✕</button>
      </div>
      <div class="tiny muted">{RES_INFO[r.kind].desc} Vote closes in {r.voteDay - g.day} days.</div>
      <div class="row" style={{ marginTop: '6px' }}>
        {(['yes', 'no'] as const).map((v) => (
          <button class={'btn sm' + (voted === v ? ' on' : '')} onClick={() => { playerVote(g, r.id, v); c.emit(); }}>
            {v === 'yes' ? '👍 Vote yes' : g.s.un.permanent.includes(me) ? '🚫 Veto' : '👎 Vote no'}
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectionBar() {
  const c = useCtl();
  const g = c.game!;
  const units = c.selectedUnits();
  if (!units.length) return null;
  const counts = new Map<string, number>();
  for (const u of units) counts.set(UNITS[u.type].name.replace(/ (Division|Brigade|Wing|Squadron|Group|Flotilla|Battery)$/, ''), (counts.get(UNITS[u.type].name.replace(/ (Division|Brigade|Wing|Squadron|Group|Flotilla|Battery)$/, '')) || 0) + 1);
  const domains = new Set(units.map((u) => UNITS[u.type].domain));
  const health = units.reduce((a, u) => a + u.str, 0) / units.length;
  const gen = units[0].gen >= 0 ? g.general(units[0].gen) : null;
  const hint = domains.has('land')
    ? 'Tap a province to send them there — tapping enemy land attacks it.'
    : domains.has('sea')
      ? 'Tap the sea or a coast to sail there.'
      : 'Tap a province to protect it from the air. Long-press for bombing.';
  return (
    <div class="selbar" onPointerDown={(e) => e.stopPropagation()}>
      <div class="spread">
        <div class="small grow">
          <b>{units.length === 1 ? units[0].name : `${units.length} units selected`}</b>
          <div class="tiny muted">
            {[...counts.entries()].map(([t, n]) => `${n}× ${t}`).join(', ')} · health {Math.round(health)}%{gen ? ` · led by ${gen.name}` : ''}
          </div>
        </div>
        <button class="btn sm ghost" onClick={() => c.clearSelection()} aria-label="Deselect">✕</button>
      </div>
      <div class="help" style={{ margin: '6px 0 0' }}>👆 {hint}</div>
      {domains.has('land') && (
        <div class="acts">
          <button class="btn sm" onClick={() => c.hold()} title="Stop moving and dig in">🛡 Stop &amp; defend</button>
          <button class="btn sm" onClick={() => c.retreat()} title="Pull back to safer friendly land">↩ Pull back</button>
          <button class={'btn sm' + (c.tool === 'frontline' ? ' on' : '')} onClick={() => c.setTool('frontline')} title="Spread these units along a line you draw">✏️ Draw front</button>
        </div>
      )}
    </div>
  );
}

function ContextMenu() {
  const c = useCtl();
  const g = c.game!;
  const m = c.menu!;
  const me = g.s.player;
  const close = () => c.closeMenu();
  const style = { left: Math.max(8, Math.min(m.x - 120, (c.renderer?.w ?? 400) - 290)) + 'px', top: Math.max(60, Math.min(m.y, (c.renderer?.h ?? 600) - 380)) + 'px' };
  const Item = ({ icon, title, desc, onClick, bad }: { icon: string; title: string; desc: string; onClick: () => void; bad?: boolean }) => (
    <button class={bad ? 'bad' : ''} onClick={() => { onClick(); close(); }}>
      <span style={{ fontSize: '18px', width: '24px' }}>{icon}</span>
      <span class="col" style={{ gap: 0, alignItems: 'flex-start' }}>
        <b>{title}</b>
        <span class="tiny muted">{desc}</span>
      </span>
    </button>
  );
  if (m.loc === -999) {
    return (
      <div class="ctxmenu" style={style} onPointerDown={(e) => e.stopPropagation()}>
        <div class="ttl">✏️ Front line ({c.frontLine.length} provinces)</div>
        <Item icon="🛡" title="Hold this line" desc="Spread your units along it to defend." onClick={() => c.applyFrontline('hold')} />
        <Item icon="⚔️" title="Attack from this line" desc="Units move to the line, then push into the enemy beyond it." onClick={() => c.applyFrontline('advance')} />
        <Item icon="✕" title="Cancel" desc="Forget this line." onClick={() => c.cancelDraw()} />
      </div>
    );
  }
  const loc = m.loc;
  const units = c.selectedUnits();
  const has = (d: string) => units.some((u) => UNITS[u.type].domain === d);
  const isProv = loc >= 0;
  const p = isProv ? g.s.provinces[loc] : null;
  const ctrl = p ? p.ctrl : -1;
  const enemy = p ? g.atWar(me, ctrl) : false;
  const name = g.locName(loc);
  return (
    <div class="ctxmenu" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div class="ttl">
        {name}
        {p && <div class="tiny muted">{g.name(p.owner)}{p.ctrl !== p.owner ? ` · occupied by ${g.name(p.ctrl)}` : ''}{enemy ? ' · ENEMY' : ''}</div>}
      </div>
      {units.length > 0 && (has('land') || has('sea')) && (
        <>
          <Item icon={enemy ? '⚔️' : '➡️'} title={enemy ? 'Attack here' : 'Move here'} desc={`Send your ${units.length} selected unit(s).`} onClick={() => c.issueOrder(loc)} />
          {has('land') && isProv && enemy && <Item icon="⭕" title="Surround it" desc="Attack from several sides. Trapped enemies surrender." onClick={() => c.onTapEncircle(loc)} />}
        </>
      )}
      {has('air') && isProv && (
        <>
          <Item icon="🛡" title="Air cover here" desc="Fighters protect this area and support battles." onClick={() => c.airMission(enemy ? 'cas' : 'superiority', loc)} />
          {enemy && <Item icon="💣" title="Bomb here" desc="Bombers and drones hit enemy troops and factories." onClick={() => c.airMission('bomb', loc)} />}
        </>
      )}
      {has('sea') && isProv && enemy && <Item icon="🚫" title="Blockade this coast" desc="Cut their sea trade and bombard their defenders." onClick={() => c.navalMission('blockade', loc)} />}
      {units.some((u) => u.type === 'missile') && isProv && enemy && <Item icon="🚀" title="Missile strike" desc="Damage enemy troops here (reloads in 5 days)." onClick={() => c.fire(loc)} bad />}
      {isProv && enemy && g.player.nukes > 0 && g.s.settings.nukes && (
        <Item
          icon="☢️"
          title="Nuclear strike"
          desc="Destroys this province. The whole world will turn against you."
          bad
          onClick={() => {
            if (!g.player.nukesArmed) { c.toast('First arm your nukes in the ⚔️ Army tab.', 'warn'); return; }
            if (!nukeRangeOk(g, me, loc)) { c.toast('None of your missiles or bombers can reach it.', 'warn'); return; }
            if (!confirm(`☢️ Launch a nuclear strike on ${name}? This cannot be undone.`)) return;
            const e = launchNuke(g, me, loc);
            if (e) c.toast(e, 'warn');
            c.renderer?.invalidate(true);
          }}
        />
      )}
      {isProv && p && p.owner === me && p.ctrl === me && (
        <>
          <Item icon="📦" title="Build supply depot" desc={BUILDINGS.depot.desc} onClick={() => { const e = construct(g, me, 'depot', loc); c.toast(e ?? `Supply depot ordered in ${name}`, e ? 'warn' : 'good'); }} />
          <Item icon="🏰" title="Build fortifications" desc={BUILDINGS.fort.desc} onClick={() => { const e = construct(g, me, 'fort', loc); c.toast(e ?? `Fortifications ordered in ${name}`, e ? 'warn' : 'good'); }} />
        </>
      )}
      {isProv && p && ctrl !== me && <Item icon="🤝" title={`Talk to ${g.name(ctrl)}`} desc="Trade, alliances, threats or peace." onClick={() => c.open('world', ctrl)} />}
      {isProv && p && ctrl !== me && !g.atWar(me, ctrl) && !g.allied(me, ctrl) && (
        <Item
          icon="⚔️"
          title={`Declare war on ${g.name(ctrl)}`}
          desc="Their allies will join them. Others will trust you less."
          bad
          onClick={() => {
            if (!confirm(`Declare war on ${g.name(ctrl)}?`)) return;
            const e = declareWar(g, me, ctrl);
            if (e) c.toast(e, 'warn');
            c.renderer?.invalidate(true);
          }}
        />
      )}
      {isProv && <Item icon="ℹ️" title="Province details" desc="Population, defenses and who is stationed here." onClick={() => c.selectProvince(loc)} />}
    </div>
  );
}

function AwayReport() {
  const c = useCtl();
  return (
    <div class="modal-bg">
      <div class="modal col">
        <h3>⏳ While you were away…</h3>
        <div class="small muted">Your advisors kept the country running. Here is what happened:</div>
        <div class="list">
          {c.awayReport!.map((l) => (
            <div class="item small">{l}</div>
          ))}
        </div>
        <button class="btn primary" onClick={() => c.dismissAway()}>
          Resume command
        </button>
      </div>
    </div>
  );
}
