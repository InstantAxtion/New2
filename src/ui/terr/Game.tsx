import { useEffect, useState } from 'preact/hooks';
import { buzz } from '../../platform/mobile';
import { cartoon } from '../../render/cartoon';
import { fmtTroops, WIN_SHARE } from '../../terr/game';
import { MODE_BY_ID } from '../../terr/setup';
import { SPEEDS, useCtl } from './controller';
import { HowToPlay, SettingsView } from './Menu';
import { Bar, NationDot, Sheet } from './ui';

const pctOf = (v: number) => (v * 100 >= 10 ? Math.round(v * 100) : (v * 100).toFixed(1)) + '%';

export function GameScreen() {
  const c = useCtl();
  const g = c.game!;
  return (
    <>
      <Hud />
      <Leaderboard />
      <Toasts />
      <Breaking />
      {!c.panel && g.human?.alive && !g.s.over && <Feed />}
      {!c.panel && !g.s.over && (
        <div class="fabs tfabs">
          <button class="fab" onClick={() => { buzz(8); c.open('news'); }} aria-label="News">📰<span class="fablabel">News</span></button>
          <button class="fab" onClick={() => { buzz(8); c.home(); }} aria-label="My land">🏠<span class="fablabel">Home</span></button>
        </div>
      )}
      {g.human?.alive && !g.s.over && <AttackBar />}
      {c.panel === 'info' && <InfoSheet />}
      {c.panel === 'news' && <NewsSheet />}
      {c.panel === 'menu' && <MenuSheet />}
      {c.popup() && !c.tutorial && <OfferPopup />}
      {c.tutorial && <Tutorial />}
      {g.s.over && <EndScreen />}
    </>
  );
}

function Hud() {
  const c = useCtl();
  const g = c.game!;
  const H = g.human!;
  const cap = g.cap(H);
  const rank = g.ranking().findIndex((p) => p.idx === H.idx) + 1;
  return (
    <div class="hud">
      <div class="row" style={{ width: '100%' }}>
        <button class="btn menubtn" onClick={() => { buzz(8); c.open('menu'); c.setSpeed(0); }} aria-label="Menu">☰</button>
        <div class="col grow" style={{ gap: '3px', minWidth: 0 }} onClick={() => c.home()}>
          <div class="row" style={{ gap: '6px' }}>
            <NationDot color={cartoon(H.color)} />
            <b class="ellipsis" style={{ fontSize: '16px' }}>{H.name}</b>
            <span class="tiny muted" style={{ flex: 'none' }}>{H.alive ? `#${rank} · ${pctOf(g.share(H))}` : 'defeated'}</span>
          </div>
          <div class="troops">
            <b>🪖 {fmtTroops(H.troops)}</b>
            <span class="tiny muted">/ {fmtTroops(cap)}</span>
            <span class="tiny good">+{fmtTroops(g.income(H))}/s</span>
          </div>
          <Bar v={H.troops / cap} color={H.troops / cap > 0.95 ? 'var(--warn)' : 'var(--good)'} h={8} />
        </div>
        <button class="btn speedbtn" onClick={() => { buzz(8); c.setSpeed(c.lastSpeed % SPEEDS.length + 1); }} aria-label="Game speed">
          {SPEEDS[c.lastSpeed - 1]}×
        </button>
        <button class={'btn play' + (c.speed === 0 ? ' paused' : '')} onClick={() => { buzz(12); c.togglePause(); }} aria-label={c.speed === 0 ? 'Play' : 'Pause'}>
          {c.speed === 0 ? '▶' : <b style={{ letterSpacing: '-2px' }}>❙❙</b>}
        </button>
      </div>
    </div>
  );
}

function Leaderboard() {
  const c = useCtl();
  const g = c.game!;
  const [open, setOpen] = useState(true);
  const rank = g.ranking();
  const me = g.s.player;
  const myRank = rank.findIndex((p) => p.idx === me);
  const top = rank.slice(0, 5);
  return (
    <div class={'board' + (open ? '' : ' shut')} onPointerDown={(e) => e.stopPropagation()}>
      <button class="bhead" onClick={() => setOpen(!open)}>🏆 {open ? 'Leaders' : `#${myRank + 1}`}</button>
      {open && (
        <>
          {top.map((p, i) => (
            <button class={'brow' + (p.idx === me ? ' me' : '')} onClick={() => c.flyToPlayer(p.idx)}>
              <span class="bn">{i + 1}</span>
              <NationDot color={cartoon(p.color)} />
              <span class="ellipsis grow">{p.name}</span>
              <b>{pctOf(g.share(p))}</b>
            </button>
          ))}
          {myRank >= 5 && (
            <button class="brow me" onClick={() => c.home()}>
              <span class="bn">{myRank + 1}</span>
              <NationDot color={cartoon(g.human!.color)} />
              <span class="ellipsis grow">{g.human!.name}</span>
              <b>{pctOf(g.share(g.human!))}</b>
            </button>
          )}
          <div class="tiny muted" style={{ padding: '2px 6px' }}>{rank.length} left · win at {Math.round(WIN_SHARE * 100)}%</div>
        </>
      )}
    </div>
  );
}

function AttackBar() {
  const c = useCtl();
  const send = c.troopsToSend();
  return (
    <div class="attackbar" onPointerDown={(e) => e.stopPropagation()}>
      <div class="spread">
        <div class="small"><b style={{ fontSize: '22px' }}>{c.pct}%</b> <span class="muted">of your troops</span></div>
        <div class="small">⚔️ <b>{fmtTroops(send)}</b> per attack</div>
      </div>
      <input class="pctslider" type="range" min={1} max={100} value={c.pct} onInput={(e) => c.setPct(+(e.target as HTMLInputElement).value)} style={{ '--p': c.pct + '%' } as never} />
      <div class="row presets">
        {[10, 25, 50, 75, 100].map((v) => (
          <button class={'chip click' + (c.pct === v ? ' on' : '')} onClick={() => { buzz(6); c.setPct(v); }}>{v}%</button>
        ))}
      </div>
      <div class="tiny muted center">Tap a neighbour or empty land to attack · tap a far coast to send a boat</div>
    </div>
  );
}

function Feed() {
  const c = useCtl();
  const g = c.game!;
  const me = g.s.player;
  const items = g.s.news.filter((n) => g.s.t - n.t < 8 && (n.big || n.who.includes(me))).slice(-3);
  if (!items.length) return null;
  return (
    <div class="feed">
      {items.map((n) => <div class={'fitem' + (n.who.includes(me) ? ' me' : '')}>{n.text}</div>)}
    </div>
  );
}

function Toasts() {
  const c = useCtl();
  const [, tick] = useState(0);
  const now = performance.now();
  const live = c.toasts.filter((t) => now - t.at < 3500);
  useEffect(() => {
    if (!live.length) return;
    const id = setTimeout(() => tick((x) => x + 1), 600);
    return () => clearTimeout(id);
  });
  return (
    <div class="toasts">
      {live.map((t) => <div class={'toast ' + t.kind} key={t.id}>{t.text}</div>)}
    </div>
  );
}

function Breaking() {
  const c = useCtl();
  const b = c.breaking;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!b) return;
    const id = setTimeout(() => tick((x) => x + 1), 5100);
    return () => clearTimeout(id);
  }, [b?.at]);
  if (!b || c.panel || performance.now() - b.at > 5000) return null;
  return (
    <div class="breaking" key={b.at} onClick={() => { c.breaking = null; c.emit(); }}>
      <span class="blabel">BREAKING</span>
      <span class="btext">{b.text}</span>
    </div>
  );
}

function OfferPopup() {
  const c = useCtl();
  const g = c.game!;
  const o = c.popup()!;
  const P = g.s.players[o.from];
  return (
    <div class="modal-bg" onPointerDown={(e) => e.stopPropagation()}>
      <div class="modal col popup">
        <div class="picon">🤝</div>
        <h3 class="center">Alliance offer!</h3>
        <div class="row" style={{ justifyContent: 'center' }}><NationDot color={cartoon(P.color)} /> <b>{P.name}</b></div>
        <div class="center">{P.name} wants to team up. Allies can't attack each other — and you can stop watching that border.</div>
        <div class="small muted center">🪖 {fmtTroops(P.troops)} troops · {pctOf(g.share(P))} of the map</div>
        <div class="row">
          <button class="btn grow" onClick={() => c.answer(false)}>No thanks</button>
          <button class="btn good grow" onClick={() => c.answer(true)}>Accept</button>
        </div>
      </div>
    </div>
  );
}

function InfoSheet() {
  const c = useCtl();
  const g = c.game!;
  const P = g.s.players[c.info];
  const me = g.s.player;
  const [msg, setMsg] = useState<string | null>(null);
  if (!P) return null;
  const H = g.human!;
  const isMe = P.idx === me;
  const ally = g.allied(me, P.idx);
  const ratio = g.density(H) / Math.max(1, g.density(P));
  const close = () => c.open(null);
  return (
    <Sheet title={<span class="row"><NationDot color={cartoon(P.color)} /> {P.name}</span>} onClose={close}>
      <div class="grid3">
        <div class="stat"><div class="l">Troops</div><div class="v">{fmtTroops(P.troops)}</div></div>
        <div class="stat"><div class="l">Land</div><div class="v">{pctOf(g.share(P))}</div></div>
        <div class="stat"><div class="l">Growth</div><div class="v good">+{fmtTroops(g.income(P))}/s</div></div>
      </div>
      {!isMe && (
        <div class="small" style={{ marginTop: '8px' }}>
          {ally ? '🤝 Your ally — you can\'t attack each other.' : ratio > 1.4 ? '💪 Their land is weakly held compared to yours — a good target.' : ratio < 0.7 ? '🛡 Heavily defended. Attacking will cost a lot of troops.' : '⚖️ About as strong as you, pixel for pixel.'}
          {!g.borders(me, P.idx) && !ally && <div class="tiny muted">You don't share a border — tap their coast to send a boat.</div>}
        </div>
      )}
      {msg && <div class="card small" style={{ marginTop: '8px' }}>{msg}</div>}
      <div class="list" style={{ marginTop: '10px' }}>
        <button class="btn block" onClick={() => { c.flyToPlayer(P.idx); close(); }}>📍 Show on map</button>
        {!isMe && !ally && g.borders(me, P.idx) && (
          <button class="btn danger block" onClick={() => {
            const e = g.attack(me, P.idx, c.troopsToSend());
            buzz(15);
            if (e) setMsg(e); else { c.toast(`⚔️ ${fmtTroops(c.troopsToSend())} troops attacking ${P.name}`); close(); }
          }}>⚔️ Attack with {c.pct}% ({fmtTroops(c.troopsToSend())})</button>
        )}
        {!isMe && !ally && <button class="btn good block" onClick={() => { const r = g.proposeAlliance(P.idx); setMsg(r.text); buzz(10); c.emit(); }}>🤝 Ask to be allies</button>}
        {ally && <button class="btn block" onClick={() => { g.breakAlliance(me, P.idx); setMsg('💔 Alliance broken. You can attack them now.'); c.emit(); }}>💔 Break the alliance</button>}
      </div>
    </Sheet>
  );
}

function NewsSheet() {
  const c = useCtl();
  const g = c.game!;
  const me = g.s.player;
  const [mine, setMine] = useState(false);
  const items = g.s.news.filter((n) => !mine || n.who.includes(me)).slice(-80).reverse();
  return (
    <Sheet title="📰 What's happening" onClose={() => c.open(null)} tall>
      <div class="chips" style={{ marginTop: 0 }}>
        <button class={'chip click' + (!mine ? ' on' : '')} onClick={() => setMine(false)}>🌍 Everyone</button>
        <button class={'chip click' + (mine ? ' on' : '')} onClick={() => setMine(true)}>⭐ You</button>
      </div>
      <div class="list" style={{ marginTop: '8px' }}>
        {items.map((n) => (
          <div class={'item news' + (n.big ? ' big' : '') + (n.who.includes(me) ? ' mine' : '')}>
            <div class="grow">
              <div class="small">{n.text}</div>
              <div class="tiny muted">{Math.floor(n.t / 60)}:{String(Math.floor(n.t % 60)).padStart(2, '0')}</div>
            </div>
          </div>
        ))}
        {!items.length && <div class="muted small">Nothing yet — it's quiet. Too quiet.</div>}
      </div>
    </Sheet>
  );
}

function MenuSheet() {
  const c = useCtl();
  const [view, setView] = useState<'main' | 'settings' | 'help'>('main');
  const [saved, setSaved] = useState(false);
  const close = () => { c.open(null); c.setSpeed(c.lastSpeed); };
  return (
    <Sheet title="☰ Paused" onClose={close} tall={view !== 'main'}>
      {view === 'main' && (
        <div class="list">
          <button class="btn primary block" onClick={close}>▶ Resume</button>
          <button class="btn block" onClick={async () => { await c.save('slot1'); setSaved(true); }}>{saved ? '✅ Saved' : '💾 Save game'}</button>
          <button class="btn block" onClick={() => setView('help')}>📖 How to play</button>
          <button class="btn block" onClick={() => setView('settings')}>⚙️ Settings</button>
          <button class="btn danger block" onClick={() => c.quitToMenu()}>🚪 Quit to menu</button>
          <div class="tiny muted center">The game also saves by itself.</div>
        </div>
      )}
      {view === 'settings' && <SettingsView onBack={() => setView('main')} />}
      {view === 'help' && <HowToPlay onBack={() => setView('main')} />}
    </Sheet>
  );
}

function EndScreen() {
  const c = useCtl();
  const g = c.game!;
  const o = g.s.over!;
  const H = g.human!;
  const mins = Math.floor(o.t / 60), secs = Math.floor(o.t % 60);
  const peakShare = H.peak / Math.max(1, g.s.playable);
  return (
    <div class="modal-bg">
      <div class="modal col center">
        <div class="picon" style={{ margin: '0 auto' }}>{o.won ? '👑' : '🏳️'}</div>
        <div class="end-title">{o.won ? 'Victory!' : 'Defeated'}</div>
        <div>{o.text}</div>
        <div class="grid3" style={{ marginTop: '6px' }}>
          <div class="stat"><div class="l">Time</div><div class="v">{mins}:{String(secs).padStart(2, '0')}</div></div>
          <div class="stat"><div class="l">Biggest</div><div class="v">{pctOf(peakShare)}</div></div>
          <div class="stat"><div class="l">Mode</div><div class="v" style={{ fontSize: '14px' }}>{MODE_BY_ID[g.s.mode].name}</div></div>
        </div>
        <button class="btn primary block" onClick={() => c.openNewGame()}>⚔️ Play again</button>
        <button class="btn block" onClick={() => c.quitToMenu()}>🏠 Main menu</button>
      </div>
    </div>
  );
}

function Tutorial() {
  const c = useCtl();
  const [step, setStep] = useState(0);
  const steps = [
    { t: 'Your troops 🪖', b: 'This number (top) is your army. It grows by itself — faster with more land — up to the limit shown by the bar. Don\'t let it sit full: use it!' },
    { t: 'Attack! ⚔️', b: 'Use the slider at the bottom to pick how many troops to send, then tap a neighbour or empty land. Your colour floods across the border until those troops run out.' },
    { t: 'Win 👑', b: `Grab ${Math.round(WIN_SHARE * 100)}% of the land to win. Tap far coasts to send ⛵ boats. Long-press a country to check it out or ask it to be your ally. Good luck!` },
  ];
  const s = steps[step];
  return (
    <div class="tut" onPointerDown={(e) => e.stopPropagation()}>
      <div class="card">
        <h3>{s.t}</h3>
        <p>{s.b}</p>
        <div class="spread" style={{ marginTop: '12px' }}>
          <div class="dots">{steps.map((_, i) => <i class={i === step ? 'on' : ''} />)}</div>
          <div class="row">
            <button class="btn sm ghost" onClick={() => c.finishTutorial()}>Skip</button>
            <button class="btn sm primary" onClick={() => (step === steps.length - 1 ? c.finishTutorial() : setStep(step + 1))}>{step === steps.length - 1 ? "Let's go!" : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
