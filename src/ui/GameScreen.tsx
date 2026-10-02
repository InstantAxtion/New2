import { useEffect, useRef, useState } from 'preact/hooks';
import { UNITS } from '../data/units';
import { pref } from '../platform/storage';
import type { Layer } from '../render/renderer';
import { declareWar } from '../sim/diplomacy';
import { BUILDINGS, construct } from '../sim/economy';
import { disband } from '../sim/military';
import { defconName, launchNuke, nukeRangeOk } from '../sim/nuclear';
import type { Toast } from '../sim/types';
import { councilName, playerVote, RES_INFO } from '../sim/un';
import { dateStr, fmt, NationDot } from './common';
import { useCtl, type Panel } from './controller';
import { EndScreen } from './EndScreen';
import { DiplomacyPanel } from './panels/Diplomacy';
import { EconomyPanel } from './panels/Economy';
import { GameMenu } from './panels/GameMenu';
import { IntelPanel } from './panels/Intel';
import { MilitaryPanel } from './panels/Military';
import { NationPanel } from './panels/Nation';
import { NewsPanel } from './panels/News';
import { ProvincePanel } from './panels/Province';
import { ResearchPanel } from './panels/Research';

const LAYERS: [Layer, string][] = [
  ['political', '🗺 Political'],
  ['terrain', '⛰ Terrain'],
  ['resources', '🛢 Resources'],
  ['supply', '📦 Supply'],
  ['unrest', '🔥 Unrest'],
  ['alliances', '🛡 Alliances'],
  ['weather', '🌦 Weather'],
];

export function GameScreen() {
  const c = useCtl();
  const g = c.game!;
  const [showLayers, setShowLayers] = useState(false);
  const inbox = g.s.inbox.filter((m) => !m.resolved && m.to === g.s.player).length;
  const tabs: [Panel, string, string, number?][] = [
    ['nation', '🏛', 'Nation'],
    ['economy', '💰', 'Economy'],
    ['military', '⚔️', 'Military'],
    ['diplomacy', '🤝', 'Diplomacy', inbox],
    ['research', '🔬', 'Research'],
    ['intel', '🕵️', 'Intel'],
    ['news', '📰', 'News'],
  ];
  const openPanel = (p: Panel) => {
    c.panel = c.panel === p ? null : p;
    c.menu = null;
    c.emit();
  };
  return (
    <>
      <Hud />
      {pref('ticker', true) && <Ticker />}
      <div class="fabs">
        <button class={'fab' + (showLayers ? ' on' : '')} onClick={() => setShowLayers(!showLayers)} title="Map layers">
          🗂
        </button>
        <button class={'fab' + (c.mode === 'globe' ? ' on' : '')} onClick={() => (c.mode === 'globe' ? c.exitGlobe() : c.enterGlobe())} title="Globe view">
          🌐
        </button>
        <button class={'fab' + (c.tool === 'frontline' ? ' on' : '')} onClick={() => c.setTool('frontline')} title="Draw front line">
          ✏️
        </button>
        <button class="fab" onClick={() => c.selectAllInView('land')} title="Select all land units on screen">
          🎯
        </button>
        <button class="fab" onClick={() => { const cap = g.player.capital; if (cap >= 0) c.focus(cap); }} title="Go to capital">
          🏠
        </button>
      </div>
      {showLayers && (
        <div class="layers">
          {LAYERS.map(([l, label]) => (
            <button class={c.layer === l ? 'on' : ''} onClick={() => { c.setLayer(l); setShowLayers(false); }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {c.tool === 'frontline' && !c.menu && (
        <div class="unbanner">
          <div class="toast warn">✏️ Drag across provinces to draw a front line. Two fingers still pan & zoom.</div>
        </div>
      )}
      <Toasts />
      <UnBanner />
      {c.selected.size > 0 && !c.panel && <SelectionBar />}
      {c.menu && <ContextMenu />}
      {c.panel === 'nation' && <NationPanel />}
      {c.panel === 'economy' && <EconomyPanel />}
      {c.panel === 'military' && <MilitaryPanel />}
      {c.panel === 'diplomacy' && <DiplomacyPanel />}
      {c.panel === 'research' && <ResearchPanel />}
      {c.panel === 'intel' && <IntelPanel />}
      {c.panel === 'news' && <NewsPanel />}
      {c.panel === 'province' && c.province >= 0 && <ProvincePanel />}
      {c.panel === 'menu' && <GameMenu />}
      <div class="tabbar">
        {tabs.map(([p, ic, label, badge]) => (
          <button class={c.panel === p ? 'on' : ''} onClick={() => openPanel(p)}>
            <span class="ic">{ic}</span>
            {label}
            {badge ? <span class="badge">{badge}</span> : null}
          </button>
        ))}
      </div>
      {c.awayReport && <AwayReport />}
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
        <button class="btn sm ghost" style={{ padding: '4px 8px' }} onClick={() => { c.panel = c.panel === 'menu' ? null : 'menu'; c.emit(); }}>
          ☰
        </button>
        <div class="nation grow" onClick={() => { c.panel = 'nation'; c.emit(); }}>
          <NationDot color={n.color} />
          <span class="ellipsis">{n.name}</span>
        </div>
        <div class="speed">
          {[0, 1, 2, 5].map((s) => (
            <button class={c.speed === s ? 'on' : ''} onClick={() => c.setSpeed(s)} aria-label={s === 0 ? 'Pause' : `Speed ${s}`}>
              {s === 0 ? <b style={{ letterSpacing: '-2px' }}>❙❙</b> : s + '×'}
            </button>
          ))}
        </div>
      </div>
      <div class="hudline">
        <span class="date">{dateStr(g)}</span>
        <span>💰 <b>{fmt.money(n.treasury)}</b> <span class={bal >= 0 ? 'good' : 'bad'}>{fmt.signed(bal * 30, 1)}B/mo</span></span>
        <span>👍 <b class={n.approval > 50 ? 'good' : n.approval > 30 ? 'warn' : 'bad'}>{Math.round(n.approval)}%</b></span>
        <span class={'defcon d' + g.s.defcon} title={defconName(g.s.defcon)}>DEFCON {g.s.defcon}</span>
      </div>
    </div>
  );
}

function Ticker() {
  const c = useCtl();
  const g = c.game!;
  const items = g.s.news.slice(-10).reverse();
  const text = items.map((n) => n.text).join('   •   ');
  const key = items[0]?.text ?? '';
  return (
    <div class="ticker" onClick={() => { c.panel = 'news'; c.emit(); }}>
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
  // auto-pause when attacked
  const last = show[show.length - 1];
  useEffect(() => {
    if (last && last.kind === 'danger' && /declared war on us|nuclear/i.test(last.text) && pref('autoPauseWar', true) && c.speed > 0) c.setSpeed(0);
  }, [last?.id]);
  return (
    <div class="toasts" style={{ top: pref('ticker', true) ? undefined : 'calc(72px + var(--safe-top))' }}>
      {show.map((t: Toast) => (
        <div class={'toast ' + t.kind} onClick={() => { if (t.loc !== undefined) c.focus(t.loc); seen.current.set(t.id, -1e9); tick((x) => x + 1); }}>
          {t.text}
        </div>
      ))}
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
    <div class="toast" style={{ position: 'absolute', left: '8px', right: '60px', bottom: 'calc(64px + var(--safe-bottom))', zIndex: 23, borderLeftColor: '#60a5fa', maxWidth: '520px' }}>
      <div class="spread">
        <b>🏛 {councilName(g)} vote · {RES_INFO[r.kind].name}: {what}</b>
        <button class="btn sm ghost" onClick={() => setHidden(r.id)}>✕</button>
      </div>
      <div class="tiny muted">{RES_INFO[r.kind].desc} Proposed by {g.name(r.proposer)} · closes in {r.voteDay - g.day} days</div>
      <div class="row" style={{ marginTop: '6px' }}>
        {(['yes', 'no', 'abstain'] as const).map((v) => (
          <button class={'btn sm' + (voted === v ? ' on' : '')} onClick={() => { playerVote(g, r.id, v); c.emit(); }}>
            {v === 'yes' ? '👍 Yes' : v === 'no' ? (g.s.un.permanent.includes(me) ? '🚫 Veto' : '👎 No') : '🤷 Abstain'}
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
  for (const u of units) counts.set(u.type, (counts.get(u.type) || 0) + 1);
  const domains = new Set(units.map((u) => UNITS[u.type].domain));
  const avgStr = units.reduce((a, u) => a + u.str, 0) / units.length;
  const avgOrg = units.reduce((a, u) => a + u.org, 0) / units.length;
  const gen = units[0].gen >= 0 ? g.general(units[0].gen) : null;
  return (
    <div class="selbar" onPointerDown={(e) => e.stopPropagation()}>
      <div class="spread">
        <div class="small grow">
          <b>{units.length === 1 ? units[0].name : `${units.length} units`}</b>
          <span class="muted"> · {[...counts.entries()].map(([t, n]) => `${n} ${UNITS[t as keyof typeof UNITS].icon}`).join(' ')}</span>
          <div class="tiny muted">
            💪 {Math.round(avgStr)}% · 🎖 {Math.round(avgOrg)}% org{gen ? ` · ${gen.name}` : ''}
            {units.length === 1 && units[0].path.length ? ` · → ${g.locName(units[0].path[units[0].path.length - 1])}` : ''}
          </div>
        </div>
        <button class="btn sm ghost" onClick={() => c.clearSelection()}>✕</button>
      </div>
      <div class="tiny muted" style={{ marginTop: '4px' }}>Tap the map to move/attack · long-press for more orders</div>
      <div class="acts">
        <button class={'btn sm' + (c.queueMode ? ' on' : '')} onClick={() => { c.queueMode = !c.queueMode; c.emit(); }}>
          ➕ Queue
        </button>
        {domains.has('land') && <button class="btn sm" onClick={() => c.hold()}>🛡 Hold</button>}
        {domains.has('land') && <button class="btn sm" onClick={() => c.retreat()}>↩ Retreat</button>}
        {domains.has('land') && (
          <button class={'btn sm' + (c.pendingEncircle ? ' on' : '')} onClick={() => { c.pendingEncircle = !c.pendingEncircle; c.toast('Tap the enemy province to encircle'); }}>
            ⭕ Encircle
          </button>
        )}
        <button class="btn sm" onClick={() => { c.panel = 'military'; c.panelArg = 2; c.emit(); }}>🎖 General</button>
        <button class="btn sm" onClick={() => { const u = units[0]; c.focus(u.loc); }}>📍 Find</button>
        <button
          class="btn sm"
          onClick={() => {
            if (!confirm(`Disband ${units.length} unit(s)?`)) return;
            for (const u of units) disband(g, u);
            c.clearSelection();
          }}
        >
          🗑 Disband
        </button>
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
  const style = { left: Math.min(m.x, (c.renderer?.w ?? 400) - 290) + 'px', top: Math.max(60, Math.min(m.y, (c.renderer?.h ?? 600) - 360)) + 'px' };
  if (m.loc === -999) {
    // front line drawn
    return (
      <div class="ctxmenu" style={style}>
        <div class="ttl">✏️ Front line · {c.frontLine.length} provinces</div>
        <div class="tiny muted" style={{ padding: '0 8px 4px' }}>{c.selected.size ? `${c.selected.size} selected units` : 'Uses idle land units nearby'}</div>
        <button onClick={() => c.applyFrontline('hold')}>🛡 Hold this line</button>
        <button onClick={() => c.applyFrontline('advance')}>⚔️ Advance from this line</button>
        <button onClick={() => c.cancelDraw()}>✕ Cancel</button>
      </div>
    );
  }
  const loc = m.loc;
  const units = c.selectedUnits();
  const has = (d: string) => units.some((u) => UNITS[u.type].domain === d);
  const missiles = units.some((u) => u.type === 'missile');
  const isProv = loc >= 0;
  const p = isProv ? g.s.provinces[loc] : null;
  const ctrl = p ? p.ctrl : -1;
  const enemy = p ? g.atWar(me, ctrl) : false;
  const name = g.locName(loc);
  const run = (f: () => void) => () => { f(); close(); };
  return (
    <div class="ctxmenu" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div class="ttl">
        {name}
        {p && <div class="tiny muted">{g.name(p.owner)}{p.ctrl !== p.owner ? ` · occupied by ${g.name(p.ctrl)}` : ''}</div>}
      </div>
      {units.length > 0 && (has('land') || has('sea')) && (
        <>
          <button onClick={run(() => c.issueOrder(loc))}>{enemy ? '⚔️ Attack' : '➡️ Move here'}</button>
          {has('land') && isProv && enemy && <button onClick={run(() => { c.pendingEncircle = true; c.onTapEncircle(loc); })}>⭕ Encircle</button>}
          <button onClick={run(() => { c.queueMode = true; c.issueOrder(loc); c.queueMode = false; })}>➕ Queue move here</button>
        </>
      )}
      {has('air') && isProv && (
        <>
          <button onClick={run(() => c.airMission('superiority', loc))}>✈️ Air superiority</button>
          <button onClick={run(() => c.airMission('cas', loc))}>💥 Close air support</button>
          {enemy && <button onClick={run(() => c.airMission('bomb', loc))}>💣 Strategic bombing</button>}
          <button onClick={run(() => c.airMission('recon', loc))}>🔭 Recon</button>
          <button onClick={run(() => c.airMission('airlift', loc))}>📦 Airlift supplies</button>
          {!enemy && <button onClick={run(() => c.issueOrder(loc))}>🛬 Rebase here</button>}
        </>
      )}
      {has('sea') && (
        <>
          <button onClick={run(() => c.navalMission('patrol', loc))}>⚓ Patrol</button>
          {isProv && <button onClick={run(() => c.navalMission('blockade', loc))}>🚫 Blockade coast</button>}
          {isProv && enemy && <button onClick={run(() => c.navalMission('bombard', loc))}>💥 Shore bombardment</button>}
          {units.some((u) => u.type === 'submarine') && <button onClick={run(() => c.navalMission('raid', loc))}>🌊 Raid shipping</button>}
        </>
      )}
      {missiles && isProv && enemy && <button class="bad" onClick={run(() => c.fire(loc))}>🚀 Missile strike</button>}
      {isProv && enemy && g.player.nukes > 0 && g.s.settings.nukes && (
        <button
          class="bad"
          onClick={run(() => {
            if (!g.player.nukesArmed) { c.toast('Arm your nuclear forces first (Military → Nuclear)', 'warn'); return; }
            if (!nukeRangeOk(g, me, loc)) { c.toast('No delivery system in range', 'warn'); return; }
            if (!confirm(`☢️ Launch a nuclear strike on ${name}? This cannot be undone.`)) return;
            const e = launchNuke(g, me, loc);
            if (e) c.toast(e, 'warn');
            c.renderer?.invalidate();
          })}
        >
          ☢️ Nuclear strike
        </button>
      )}
      {units.length > 0 && has('land') && <button onClick={run(() => c.hold())}>🛡 Hold position</button>}
      {isProv && p && p.owner === me && p.ctrl === me && (
        <>
          {(['depot', 'fort', 'infra'] as const).map((b) => (
            <button onClick={run(() => { const e = construct(g, me, b, loc); c.toast(e ?? `${BUILDINGS[b].name} ordered in ${name}`, e ? 'warn' : 'good'); })}>
              🏗 Build {BUILDINGS[b].name}
            </button>
          ))}
        </>
      )}
      {isProv && p && ctrl !== me && !g.atWar(me, ctrl) && !g.allied(me, ctrl) && (
        <button
          class="bad"
          onClick={run(() => {
            if (!confirm(`Declare war on ${g.name(ctrl)}?`)) return;
            const e = declareWar(g, me, ctrl);
            if (e) c.toast(e, 'warn');
            c.renderer?.invalidate();
          })}
        >
          ⚔️ Declare war on {g.name(ctrl)}
        </button>
      )}
      {isProv && p && ctrl !== me && <button onClick={run(() => { c.panel = 'diplomacy'; c.panelArg = ctrl; c.emit(); })}>🤝 Diplomacy with {g.name(ctrl)}</button>}
      {isProv && <button onClick={run(() => c.selectProvince(loc))}>ℹ️ Province info</button>}
      <button onClick={close}>✕ Close</button>
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
        <button class="btn primary" onClick={() => c.dismissAway()}>
          Resume command
        </button>
      </div>
    </div>
  );
}
