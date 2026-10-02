import { useEffect, useMemo, useState } from 'preact/hooks';
import { SCENARIOS, type ScenarioDef } from '../data/scenarios';
import { UNITS } from '../data/units';
import type { Game } from '../sim/ctx';
import { militaryPower } from '../sim/diplomacy';
import type { GameSettings } from '../sim/types';
import { fmt, NationDot, Tabs, Toggle } from './common';
import { ctl, useCtl } from './controller';

type Cat = ScenarioDef['category'];

function defaultPlayer(sc: ScenarioDef, g?: Game): string {
  if (sc.playerChoices?.length) return sc.playerChoices[0];
  if (sc.region === 'Europe') return 'FRA';
  if (sc.region === 'Asia') return 'JPN';
  if (sc.region === 'Africa') return 'NGA';
  if (sc.region === 'Americas') return 'BRA';
  if (sc.region === 'Middle East') return 'SAU';
  if (sc.goal?.kind === 'continent') return 'KEN';
  void g;
  return 'USA';
}

export function NewGame() {
  const c = useCtl();
  const [step, setStep] = useState<'scenario' | 'country' | 'settings'>('scenario');
  const [cat, setCat] = useState<Cat>('sandbox');
  const [sc, setSc] = useState<ScenarioDef | null>(null);
  const [picked, setPicked] = useState<number>(-1);
  const [search, setSearch] = useState('');
  const [seed] = useState(() => (Date.now() & 0x7fffffff));
  const [opts, setOpts] = useState<Partial<GameSettings>>({ nukes: true, fog: true, difficulty: 'normal', notifications: true, offlineProgress: true });

  const g = c.game;
  const chooseScenario = (s: ScenarioDef) => {
    setSc(s);
    const pg = ctl.preview({ scenario: s.id, player: defaultPlayer(s), seed });
    setPicked(pg.s.player);
    setStep('country');
  };
  const allowed = (idx: number) => {
    if (!g || !sc) return false;
    const n = g.s.nations[idx];
    if (!n?.alive || !n.active) return false;
    if (sc.playerChoices && !sc.playerChoices.includes(n.id)) return false;
    if (sc.goal?.kind === 'continent' && n.cont !== sc.goal.cont) return false;
    return true;
  };
  useEffect(() => {
    ctl.onPick = (p: number) => {
      const gg = ctl.game;
      if (!gg) return;
      const owner = gg.s.provinces[p].owner;
      if (allowed(owner)) {
        setPicked(owner);
        gg.s.player = owner;
        if (ctl.renderer) { ctl.renderer.selectedProvince = -1; ctl.renderer.invalidate(); }
      } else ctl.toast(`${gg.s.nations[owner].name} is not playable in this scenario`, 'warn');
    };
    return () => { ctl.onPick = null; };
  }, [g, sc]);

  if (step === 'scenario') {
    const list = SCENARIOS.filter((s) => s.category === cat);
    return (
      <div class="screen menu-bg" style={{ zIndex: 5 }}>
        <div class="picker-top">
          <div class="spread">
            <h2>New Game</h2>
            <button class="btn sm" onClick={() => { ctl.screen = 'menu'; ctl.emit(); }}>
              Back
            </button>
          </div>
          <div style={{ marginTop: '10px' }}>
            <Tabs<Cat> tabs={[['sandbox', '🌍 Sandbox'], ['scenario', '📜 Scenarios'], ['challenge', '🏆 Challenges'], ['quick', '⚡ Quick Match']]} value={cat} onChange={setCat} />
          </div>
        </div>
        <div class="scroll" style={{ padding: '12px', flex: 1 }}>
          <div class="list">
            {list.map((s) => (
              <div class="card scn" onClick={() => chooseScenario(s)}>
                <h4>{s.name}</h4>
                <div class="small muted">{s.desc}</div>
                <div class="row wrap" style={{ marginTop: '8px' }}>
                  <span class="chip">📅 {s.year}</span>
                  {s.wars?.length ? <span class="chip bad">⚔️ {s.wars.length} active war{s.wars.length > 1 ? 's' : ''}</span> : null}
                  {s.region && <span class="chip">🗺 {s.region} only</span>}
                  {s.playerChoices && <span class="chip">👤 {s.playerChoices.length === 1 ? 'Fixed nation' : `${s.playerChoices.length} nations`}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!g || !sc) return null;
  const n = picked >= 0 ? g.s.nations[picked] : null;

  if (step === 'settings') {
    return (
      <div class="modal-bg" style={{ zIndex: 60 }}>
        <div class="modal col">
          <div class="spread">
            <h3>Game Settings</h3>
            <button class="btn sm" onClick={() => setStep('country')}>
              Back
            </button>
          </div>
          <div class="section">Difficulty</div>
          <div class="list">
            {([['easy', '😌 Easy', 'Other countries rarely attack you. Good for learning.'], ['normal', '⚖️ Normal', 'A realistic, balanced world.'], ['hard', '🔥 Hard', 'Aggressive rivals who will come for you.']] as const).map(([d, label, desc]) => (
              <div class={'item click' + (opts.difficulty === d ? ' card sel' : '')} onClick={() => setOpts({ ...opts, difficulty: d })}>
                <div class="grow"><b>{label}</b><div class="tiny muted">{desc}</div></div>
                {opts.difficulty === d && <b class="good">✓</b>}
              </div>
            ))}
          </div>
          <div class="section">Rules</div>
          <Toggle label="🌫 Fog of war" desc="You only see enemy troops near your own land and units." on={!!opts.fog} onChange={(v) => setOpts({ ...opts, fog: v })} />
          <Toggle label="☢️ Nuclear weapons" desc="Turn off to remove nukes from the game." on={!!opts.nukes} onChange={(v) => setOpts({ ...opts, nukes: v })} />
          <button class="btn primary block" style={{ marginTop: '12px' }} disabled={!n} onClick={() => n && start()}>
            ▶ Start as {n?.name}
          </button>
        </div>
      </div>
    );
  }

  function start() {
    if (!n || !sc) return;
    ctl.newGame({ scenario: sc.id, player: n.id, seed, settings: opts });
  }

  return (
    <>
      <div class="picker-top" style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
        <div class="spread">
          <button class="btn sm" onClick={() => { setStep('scenario'); ctl.openNewGame(); }}>
            ‹ Scenarios
          </button>
          <div class="grow ellipsis center">
            <b>{sc.name}</b>
          </div>
        </div>
        <div class="small muted center" style={{ marginTop: '6px' }}>
          Tap a country on the map or search below
        </div>
      </div>
      <div class="picker-bottom">
        <input type="search" placeholder="🔍 Search countries…" value={search} onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
        {search && <NationSearch g={g} q={search} allowed={allowed} onPick={(i) => { setPicked(i); g.s.player = i; ctl.renderer?.invalidate(); setSearch(''); const cap = g.s.nations[i].capital; if (cap >= 0) ctl.renderer?.centerOnProvince(cap, 3); }} />}
        {n && !search && <NationCard g={g} idx={n.idx} />}
        <div class="row" style={{ marginTop: '10px' }}>
          <button class="btn" onClick={() => setStep('settings')}>
            ⚙️ Difficulty
          </button>
          <button class="btn primary grow" disabled={!n} onClick={start}>
            ▶ Play as {n?.name ?? '…'}
          </button>
        </div>
      </div>
    </>
  );
}

function NationSearch({ g, q, allowed, onPick }: { g: Game; q: string; allowed: (i: number) => boolean; onPick: (i: number) => void }) {
  const res = g.s.nations.filter((n) => allowed(n.idx) && n.name.toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  return (
    <div class="list" style={{ marginTop: '8px' }}>
      {res.map((n) => (
        <div class="item click" onClick={() => onPick(n.idx)}>
          <NationDot color={n.color} />
          <div class="grow">{n.name}</div>
          <span class="tiny muted">{fmt.money(n.income * 30)}/mo</span>
        </div>
      ))}
      {!res.length && <div class="muted small">No playable nation matches.</div>}
    </div>
  );
}

export function NationCard({ g, idx }: { g: Game; idx: number }) {
  const n = g.s.nations[idx];
  const stats = useMemo(() => {
    const units = g.unitsOf(idx);
    const count = (d: string) => units.filter((u) => UNITS[u.type].domain === d).length;
    const pop = g.s.provinces.reduce((a, p) => a + (p.owner === idx ? p.pop : 0), 0);
    const gdpRank = g.s.nations.filter((x) => x.alive).sort((a, b) => b.income - a.income).findIndex((x) => x.idx === idx) + 1;
    const milRank = g.s.nations.filter((x) => x.alive).map((x) => ({ i: x.idx, p: militaryPower(g, x.idx) })).sort((a, b) => b.p - a.p).findIndex((x) => x.i === idx) + 1;
    const provinces = g.s.provinces.filter((p) => p.owner === idx).length;
    const diff = gdpRank <= 10 ? ['Easy', 'good'] : gdpRank <= 40 ? ['Normal', ''] : gdpRank <= 100 ? ['Hard', 'warn'] : ['Very hard', 'bad'];
    return { land: count('land'), air: count('air'), sea: count('sea'), pop, gdpRank, milRank, provinces, diff };
  }, [g, idx]);
  const wars = g.s.wars.filter((w) => w.att.includes(idx) || w.def.includes(idx));
  const bloc = g.blocOf(idx);
  return (
    <div class="card" style={{ marginTop: '8px' }}>
      <div class="row">
        <NationDot color={n.color} />
        <b class="grow" style={{ fontSize: '16px' }}>{n.name}</b>
        <span class={'chip ' + stats.diff[1]}>{stats.diff[0]}</span>
      </div>
      <div class="grid3" style={{ marginTop: '8px' }}>
        <div><div class="tiny muted">Income</div><b>{fmt.money(n.income * 30)}</b><span class="tiny muted">/mo #{stats.gdpRank}</span></div>
        <div><div class="tiny muted">Population</div><b>{fmt.pop(stats.pop)}</b></div>
        <div><div class="tiny muted">Military</div><b>#{stats.milRank}</b></div>
        <div><div class="tiny muted">Troops / Planes / Ships</div><b>{stats.land}/{stats.air}/{stats.sea}</b></div>
        <div><div class="tiny muted">Regions</div><b>{stats.provinces}</b></div>
        <div><div class="tiny muted">Style</div><b style={{ textTransform: 'capitalize' }}>{n.gov}</b></div>
      </div>
      <div class="row wrap" style={{ marginTop: '8px' }}>
        {n.nukes > 0 && <span class="chip warn">☢️ {n.nukes} warheads</span>}
        {bloc && <span class="chip" style={{ borderColor: bloc.color }}>🛡 {bloc.name}</span>}
        {wars.map((w) => <span class="chip bad">⚔️ {w.name}</span>)}
      </div>
    </div>
  );
}
