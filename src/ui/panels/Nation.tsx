import { LEADER_TITLE } from '../../data/countries';
import { SCENARIO_BY_ID } from '../../data/scenarios';
import { purge, setGovernmentPolicy, startPropaganda } from '../../sim/politics';
import { continentShare, gdpRank, scores, worldShare } from '../../sim/victory';
import { Bar, fmt, NationDot, Sheet, Spark, Stat, Toggle } from '../common';
import { useCtl } from '../controller';

export function NationPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const close = () => { c.panel = null; c.emit(); };
  const v = g.s.settings.victory;
  const sc = SCENARIO_BY_ID[g.s.scenario];
  const ranking = scores(g).slice(0, 8);
  const myRank = scores(g).findIndex((x) => x.n === n.idx) + 1;
  const daysToElection = n.gov === 'democracy' ? n.nextElection - g.day : null;
  const bloc = g.blocOf(n.idx);
  const tot = g.s.nations.reduce((a, x) => a + (x.alive ? x.gdp : 0), 0);
  const blocShare = bloc ? bloc.members.reduce((a, m) => a + g.s.nations[m].gdp, 0) / tot : 0;
  return (
    <Sheet title={<span class="row"><NationDot color={n.color} /> {n.name}</span>} onClose={close} tall>
      <div class="small muted" style={{ textTransform: 'capitalize' }}>
        {n.gov} · {LEADER_TITLE[n.gov]} · {sc?.name}
      </div>
      <div class="grid2" style={{ marginTop: '10px' }}>
        <Stat label="Approval" value={Math.round(n.approval) + '%'} cls={n.approval > 50 ? 'good' : n.approval > 30 ? 'warn' : 'bad'} sub={<Bar v={n.approval / 100} />} />
        <Stat label="Stability" value={Math.round(n.stability) + '%'} cls={n.stability > 50 ? 'good' : n.stability > 30 ? 'warn' : 'bad'} sub={<Bar v={n.stability / 100} color="#a78bfa" />} />
        <Stat label="War support" value={Math.round(n.warSupport) + '%'} sub={<Bar v={n.warSupport / 100} color="#f97316" />} />
        <Stat label="War weariness" value={Math.round(n.warWeariness) + '%'} cls={n.warWeariness > 50 ? 'bad' : ''} sub={<Bar v={n.warWeariness / 100} color="#ef4444" />} />
      </div>
      <div class="row wrap" style={{ marginTop: '8px' }}>
        {daysToElection !== null && <span class="chip">🗳 Election in {Math.max(0, Math.round(daysToElection / 30))} months</span>}
        {n.electionLost > 0 && <span class="chip warn">📉 New government ({Math.round(n.electionLost / 30)} mo)</span>}
        {n.infamy > 10 && <span class={'chip ' + (n.infamy > 40 ? 'bad' : 'warn')}>😠 Infamy {Math.round(n.infamy)}</span>}
        {n.propaganda > 0 && <span class="chip good">📣 Propaganda ({n.propaganda}d)</span>}
        {bloc && <span class="chip">🛡 {bloc.name}{bloc.leader === n.idx ? ' (leader)' : ''}</span>}
        {g.s.un.secGen === n.idx && <span class="chip good">🏛 Secretary-General</span>}
      </div>
      {n.gov !== 'democracy' && n.coupPlot > 0.4 && (
        <div class="card" style={{ marginTop: '10px', borderColor: 'var(--bad)' }}>
          <b class="bad">🕵️ Coup risk: {Math.round(n.coupPlot * 100)}%</b>
          <div class="small muted">Officers are plotting. Raise stability, or purge the military (lowers army organisation and may kill generals).</div>
          <button class="btn danger sm" style={{ marginTop: '6px' }} onClick={() => { purge(g, n.idx); c.emit(); }}>Purge the officer corps</button>
        </div>
      )}

      <div class="section">Policies</div>
      <div class="col">
        <div class="small">Conscription law</div>
        <div class="row">
          {(['volunteer', 'limited', 'mass'] as const).map((l) => (
            <button class={'btn sm grow' + (n.conscription === l ? ' on' : '')} onClick={() => { setGovernmentPolicy(g, n.idx, 'conscription', l); c.emit(); }}>
              {l === 'volunteer' ? 'Professional' : l === 'limited' ? 'Limited draft' : 'Mass mobilisation'}
            </button>
          ))}
        </div>
        <div class="tiny muted">Professional: +10% quality, costly, few recruits. Mass mobilisation: huge manpower, −15% quality, −10 approval, −1% growth.</div>
        <button class="btn sm" disabled={n.propaganda > 0} onClick={() => { const e = startPropaganda(g, n.idx); if (e) c.toast(e, 'warn'); c.emit(); }}>
          📣 Propaganda campaign (+approval & war support for 90 days)
        </button>
      </div>

      <div class="section">Advisors (automation)</div>
      <div class="list">
        <Toggle label="💰 Economy advisor" desc="Balances budget, taxes and war economy." on={n.advisors.economy} onChange={(v) => { n.advisors.economy = v; c.emit(); }} />
        <Toggle label="🏭 Production advisor" desc="Keeps the factories building a balanced force." on={n.advisors.production} onChange={(v) => { n.advisors.production = v; c.emit(); }} />
        <Toggle label="🔬 Research advisor" desc="Picks research automatically." on={n.advisors.research} onChange={(v) => { n.advisors.research = v; c.emit(); }} />
        <Toggle label="🤝 Diplomacy advisor" desc="Answers incoming proposals for you." on={n.advisors.diplomacy} onChange={(v) => { n.advisors.diplomacy = v; c.emit(); }} />
        <Toggle label="⚔️ Military advisor" desc="Commands all your forces: fronts, air and navy." on={n.advisors.military} onChange={(v) => { n.advisors.military = v; c.emit(); }} />
      </div>

      <div class="section">History</div>
      <div class="grid2">
        <div class="card"><div class="tiny muted">GDP</div><Spark values={n.history.map((h) => h.gdp)} color="#22c55e" /></div>
        <div class="card"><div class="tiny muted">Approval</div><Spark values={n.history.map((h) => h.approval)} color="#60a5fa" /></div>
      </div>

      <div class="section">Victory</div>
      <div class="list small">
        {v.conquest > 0 && <div class="item"><span class="grow">⚔️ World control</span><b>{fmt.pct(worldShare(g, n.idx), 1)} / {fmt.pct(v.conquest)}</b></div>}
        {v.economic > 0 && <div class="item"><span class="grow">💰 GDP rank (years at #1)</span><b>#{gdpRank(g, n.idx)} ({n.topGdpYears}/{v.economic})</b></div>}
        {v.diplomatic && <div class="item"><span class="grow">🤝 Secretary-General wins · bloc GDP</span><b>{g.s.un.secGenWins[n.idx] || 0}/2 · {fmt.pct(blocShare)}/60%</b></div>}
        {v.tech && <div class="item"><span class="grow">🚀 Mars program</span><b>{n.techs.includes('mars_program') ? 'Done' : 'Not yet'}</b></div>}
        {sc?.goal?.kind === 'continent' && <div class="item"><span class="grow">🌍 Control of {sc.goal.cont}</span><b>{fmt.pct(continentShare(g, n.idx, sc.goal.cont))} / {fmt.pct(sc.goal.share)}</b></div>}
        {sc?.goal?.kind === 'survive' && <div class="item"><span class="grow">🛡 Survive</span><b>{(g.day / 365).toFixed(1)} / {sc.goal.years} years</b></div>}
        {sc?.goal?.kind === 'gdp_rank' && <div class="item"><span class="grow">📈 GDP rank</span><b>#{gdpRank(g, n.idx)} → #{sc.goal.rank}</b></div>}
        <div class="item"><span class="grow">🗓 Game ends</span><b>{v.endYear}</b></div>
      </div>

      <div class="section">World power ranking (you: #{myRank})</div>
      <div class="list">
        {ranking.map((r, i) => (
          <div class="item small">
            <b style={{ width: '18px' }}>{i + 1}</b>
            <NationDot color={g.s.nations[r.n].color} />
            <span class={'grow' + (r.n === n.idx ? ' gold' : '')}>{g.name(r.n)}</span>
            <b>{r.score}</b>
          </div>
        ))}
      </div>

      <div class="section">Public opinion</div>
      <div class="list">
        {g.s.social.filter((p) => p.nation === n.idx).slice(-6).reverse().map((p) => (
          <div class="post">
            <div class="who">{p.author}</div>
            <div class="small">{p.text}</div>
            <div class="tiny muted">❤️ {fmt.num(p.likes)} · {p.mood > 0.3 ? '😊' : p.mood < -0.3 ? '😠' : '😐'}</div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
