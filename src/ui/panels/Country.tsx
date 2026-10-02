import { useState } from 'preact/hooks';
import { RES_NAMES } from '../../data/countries';
import { SCENARIO_BY_ID } from '../../data/scenarios';
import { TECH_BY_ID } from '../../data/techs';
import { purge, setGovernmentPolicy } from '../../sim/politics';
import { available, setResearch, techCost } from '../../sim/tech';
import { RESOURCES, type Resource } from '../../sim/types';
import { continentShare, gdpRank, scores, worldShare } from '../../sim/victory';
import { Bar, fmt, Help, NationDot, Sheet, Slider, Toggle } from '../common';
import { useCtl } from '../controller';

const SHORTAGE_EFFECT: Record<Resource, string> = {
  oil: 'armies and tanks move and fight worse',
  gas: 'the economy grows slower',
  steel: 'new units take longer to build',
  rare: 'advanced weapons are harder to build',
  uranium: 'nuclear weapons cannot be built',
  food: 'people go hungry: approval and stability fall',
  electronics: 'research slows down',
};

export function CountryPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const [pickTech, setPickTech] = useState(false);
  const close = () => c.open(null);
  const bal = n.income + n.tradeIncome - n.expense;
  const shortages = RESOURCES.filter((r) => n.shortage[r] > 0.05);
  const cur = n.researching ? TECH_BY_ID[n.researching] : null;
  const curCost = n.researching ? techCost(g, n.idx, n.researching) : 1;
  const v = g.s.settings.victory;
  const sc = SCENARIO_BY_ID[g.s.scenario];
  const rank = scores(g);
  const myRank = rank.findIndex((x) => x.n === n.idx) + 1;
  return (
    <Sheet title={<span class="row"><NationDot color={n.color} /> {n.name}</span>} onClose={close} tall>
      {/* ---------------- people */}
      <div class="grid2">
        <div class="stat">
          <div class="l">Approval</div>
          <div class={'v ' + (n.approval > 50 ? 'good' : n.approval > 35 ? 'warn' : 'bad')}>{Math.round(n.approval)}%</div>
          <Bar v={n.approval / 100} />
          <div class="tiny muted">How happy people are with you.{n.gov === 'democracy' ? ` Election in ${Math.max(0, Math.round((n.nextElection - g.day) / 30))} months.` : ''}</div>
        </div>
        <div class="stat">
          <div class="l">Stability</div>
          <div class={'v ' + (n.stability > 50 ? 'good' : n.stability > 35 ? 'warn' : 'bad')}>{Math.round(n.stability)}%</div>
          <Bar v={n.stability / 100} color="#a78bfa" />
          <div class="tiny muted">Low stability causes riots{n.gov === 'democracy' ? '' : ' and coups'}.</div>
        </div>
      </div>
      {n.gov !== 'democracy' && n.coupPlot > 0.4 && (
        <div class="card" style={{ marginTop: '8px', borderColor: 'var(--bad)' }}>
          <b class="bad">🕵️ Officers are plotting a coup!</b>
          <div class="small muted">If it succeeds, you lose the game. Raise approval, or purge the army leadership (your troops get weaker for a while).</div>
          <button class="btn danger sm" style={{ marginTop: '6px' }} onClick={() => { purge(g, n.idx); c.emit(); }}>Purge the officers</button>
        </div>
      )}

      {/* ---------------- money */}
      <div class="section">💰 Money</div>
      <div class="grid3">
        <div class="stat"><div class="l">Treasury</div><div class="v">{fmt.money(n.treasury)}</div></div>
        <div class="stat"><div class="l">Per month</div><div class={'v ' + (bal >= 0 ? 'good' : 'bad')}>{bal >= 0 ? '+' : ''}{fmt.money(bal * 30)}</div></div>
        <div class="stat"><div class="l">Economy</div><div class="v">{fmt.money(n.gdp)}</div><div class={'tiny ' + (n.growth >= 0 ? 'good' : 'bad')}>{fmt.signed(n.growth)}%/yr</div></div>
      </div>
      {bal < 0 && n.treasury <= 0 && <Help>You are spending more than you earn, so you are borrowing. Too much debt can cause a credit crisis.</Help>}
      <div style={{ marginTop: '8px' }}>
        <Toggle label="🧑‍💼 Advisor manages the budget" desc="Sets taxes and spending for you. Turn off to choose yourself." on={n.advisors.economy} onChange={(on) => { n.advisors.economy = on; c.emit(); }} />
      </div>
      {!n.advisors.economy && (
        <div class="col" style={{ marginTop: '8px' }}>
          <Slider label="Taxes" value={n.taxRate} min={0.05} max={0.6} step={0.01} display={fmt.pct(n.taxRate)} onInput={(x) => { n.taxRate = x; c.emit(); }} />
          <div class="tiny muted">More money for you — but above 30% people get unhappy.</div>
          <Slider label="🪖 Military spending" value={n.budget.military} min={0} max={0.2} step={0.002} display={fmt.pct(n.budget.military, 1)} onInput={(x) => { n.budget.military = x; c.emit(); }} />
          <div class="tiny muted">Pays your soldiers and builds new units.{n.readiness < 0.95 ? <span class="bad"> Too low: your troops are underpaid and weaker!</span> : ''}</div>
          <Slider label="🏥 Welfare" value={n.budget.welfare} min={0} max={0.35} step={0.005} display={fmt.pct(n.budget.welfare, 1)} onInput={(x) => { n.budget.welfare = x; c.emit(); }} />
          <div class="tiny muted">Healthcare and pensions keep people happy.</div>
          <Slider label="🔬 Science & roads" value={n.budget.research} min={0} max={0.08} step={0.001} display={fmt.pct(n.budget.research, 1)} onInput={(x) => { n.budget.research = x; n.budget.infrastructure = Math.max(0.01, x * 1.5); c.emit(); }} />
          <div class="tiny muted">Faster research and a faster-growing economy.</div>
        </div>
      )}
      {shortages.length > 0 && (
        <div class="card" style={{ marginTop: '8px', borderColor: 'var(--warn)' }}>
          <b class="warn">⚠️ Shortages</b>
          {shortages.map((r) => (
            <div class="small">Not enough <b>{RES_NAMES[r].toLowerCase()}</b>: {SHORTAGE_EFFECT[r]}.</div>
          ))}
          <div class="tiny muted">Make peace with trading partners or capture provinces that produce it.</div>
        </div>
      )}

      {/* ---------------- research */}
      <div class="section">🔬 Research</div>
      <div class="card">
        {cur ? (
          <>
            <div class="spread"><b>{cur.name}</b><span class="tiny muted">{Math.min(100, Math.round((n.rp / curCost) * 100))}%</span></div>
            <Bar v={n.rp / curCost} color="var(--gold)" />
            <div class="tiny muted" style={{ marginTop: '4px' }}>{cur.desc}</div>
          </>
        ) : (
          <div class="muted small">Nothing being researched.</div>
        )}
        <div class="row" style={{ marginTop: '8px' }}>
          <button class="btn sm" onClick={() => setPickTech(!pickTech)}>{pickTech ? 'Hide choices' : 'Choose research'}</button>
          <span class="tiny muted grow">{n.advisors.research ? 'Your advisor picks the next one automatically.' : 'You pick each technology.'}</span>
        </div>
        {pickTech && (
          <div class="list" style={{ marginTop: '8px' }}>
            {available(g, n.idx).sort((a, b) => techCost(g, n.idx, a.id) - techCost(g, n.idx, b.id)).slice(0, 10).map((t) => (
              <div class="item click" onClick={() => { setResearch(g, n.idx, t.id); n.advisors.research = false; setPickTech(false); c.emit(); }}>
                <div class="grow">
                  <div class="small"><b>{t.name}</b></div>
                  <div class="tiny muted">{t.desc}</div>
                </div>
                <span class="tiny muted">{Math.round(techCost(g, n.idx, t.id))} pts</span>
              </div>
            ))}
            <div class="tiny muted">Picking one turns the research advisor off. You can turn it back on below.</div>
          </div>
        )}
      </div>

      {/* ---------------- laws */}
      <div class="section">📜 Laws</div>
      <div class="small">Military service</div>
      <div class="row" style={{ marginTop: '4px' }}>
        {(['volunteer', 'limited', 'mass'] as const).map((l) => (
          <button class={'btn sm grow' + (n.conscription === l ? ' on' : '')} onClick={() => { setGovernmentPolicy(g, n.idx, 'conscription', l); c.emit(); }}>
            {l === 'volunteer' ? 'Volunteers' : l === 'limited' ? 'Draft' : 'Total war'}
          </button>
        ))}
      </div>
      <div class="tiny muted" style={{ marginTop: '4px' }}>
        {n.conscription === 'volunteer' ? 'Volunteers: better soldiers, but few recruits and costly.' : n.conscription === 'limited' ? 'Draft: a balanced number of recruits.' : 'Total war: huge numbers of recruits, but weaker troops and unhappy people.'}
      </div>
      <div style={{ marginTop: '8px' }}>
        <Toggle label="🏭 War economy" desc="Factories build weapons 75% faster, but the economy grows slower and people are less happy." on={n.warEconomy} onChange={(on) => { n.warEconomy = on; c.emit(); }} />
      </div>

      {/* ---------------- advisors */}
      <div class="section">🧑‍💼 Let advisors handle…</div>
      <div class="list">
        <Toggle label="Research" desc="Choose the next technology automatically." on={n.advisors.research} onChange={(on) => { n.advisors.research = on; c.emit(); }} />
        <Toggle label="Recruiting" desc="Build new units automatically with your military budget." on={n.advisors.production} onChange={(on) => { n.advisors.production = on; c.emit(); }} />
        <Toggle label="Battles" desc="Command all your troops, planes and ships for you." on={n.advisors.military} onChange={(on) => { n.advisors.military = on; c.emit(); }} />
        <Toggle label="Foreign messages" desc="Answer offers and demands from other countries." on={n.advisors.diplomacy} onChange={(on) => { n.advisors.diplomacy = on; c.emit(); }} />
      </div>

      {/* ---------------- goals */}
      <div class="section">🏆 How to win</div>
      <div class="list small">
        {sc?.goal?.kind === 'continent' && <div class="item"><span class="grow">Control {fmt.pct(sc.goal.share)} of {sc.goal.cont}</span><b>{fmt.pct(continentShare(g, n.idx, sc.goal.cont))}</b></div>}
        {sc?.goal?.kind === 'survive' && <div class="item"><span class="grow">Survive {sc.goal.years} years</span><b>{(g.day / 365).toFixed(1)} yrs</b></div>}
        {sc?.goal?.kind === 'gdp_rank' && <div class="item"><span class="grow">Reach top {sc.goal.rank} economy</span><b>#{gdpRank(g, n.idx)}</b></div>}
        {v.conquest > 0 && <div class="item"><span class="grow">⚔️ Control {fmt.pct(v.conquest)} of the {g.s.settings.region ? 'region' : 'world'}</span><b>{fmt.pct(worldShare(g, n.idx), 1)}</b></div>}
        {v.economic > 0 && <div class="item"><span class="grow">💰 Biggest economy for {v.economic} years</span><b>#{gdpRank(g, n.idx)} now</b></div>}
        {v.diplomatic && <div class="item"><span class="grow">🤝 Win two UN Secretary-General votes</span><b>{g.s.un.secGenWins[n.idx] || 0}/2</b></div>}
        {v.tech && <div class="item"><span class="grow">🚀 Finish the Mars program (research)</span><b>{n.techs.includes('mars_program') ? '✓' : '…'}</b></div>}
        <div class="item"><span class="grow">🌍 Your world ranking</span><b>#{myRank}</b></div>
      </div>
    </Sheet>
  );
}
