import { SCENARIO_BY_ID } from '../../data/scenarios';
import { regionCount } from '../../sim/diplomacy';
import { buildCost, buildingGain, canConstruct, paybackMonths } from '../../sim/economy';
import { continentShare, incomeRank, scores, worldShare } from '../../sim/victory';
import { Bar, fmt, Help, NationDot, Sheet, Spark } from '../common';
import { useCtl } from '../controller';

export function CountryPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const me = g.s.player;
  const net = n.income - n.upkeep;
  const blockers = g.s.nations.filter((m) => m.alive && m.idx !== me && (g.atWar(m.idx, me) || g.s.embargo.includes(m.idx + '>' + me)));
  const price = g.s.price;
  // what mines already earn, and the best place for the next one
  let mineIncome = 0;
  let best: { i: number; gain: number; cost: number } | null = null as { i: number; gain: number; cost: number } | null;
  for (let i = 0; i < g.s.provinces.length; i++) {
    const p = g.s.provinces[i];
    if (p.ctrl !== me) continue;
    const gain = buildingGain(g, 'mine', i); // every mine level adds the same amount
    mineIncome += gain * (p.b.mine ?? 0);
    const err = canConstruct(g, me, 'mine', i);
    if (p.owner === me && (!err || err === 'Not enough money') && (!best || gain > best.gain)) best = { i, gain, cost: buildCost('mine', p.b.mine ?? 0).money };
  }
  return (
    <Sheet title={`🏛 ${n.name}`} onClose={() => c.open(null)} tall>
      <div class="grid3">
        <div class="stat"><div class="l">Treasury</div><div class="v">{fmt.money(n.money)}</div></div>
        <div class="stat"><div class="l">Income</div><div class="v good">+{fmt.money(n.income * 30)}</div><div class="tiny muted">a month</div></div>
        <div class="stat"><div class="l">Army</div><div class="v bad">−{fmt.money(n.upkeep * 30)}</div><div class="tiny muted">a month</div></div>
      </div>
      <div class={'small ' + (net >= 0 ? 'good' : 'bad')} style={{ marginTop: '6px' }}>
        {net >= 0 ? `💰 You save ${fmt.money(net * 30)} a month.` : `💸 You lose ${fmt.money(-net * 30)} a month — when money runs out your troops start to desert.`}
      </div>

      <div class="section">💵 Where the money comes from</div>
      <div class="list">
        <div class="item">
          <span style={{ fontSize: '22px' }}>🏛</span>
          <div class="grow">
            <div class="spread small"><b>Taxes</b><b class="good">+{fmt.money(n.taxes * 30)}/mo</b></div>
            <div class="tiny muted">From your {regionCount(g, me)} regions. Big cities pay most; 🏭 factories add +25% each; captured regions pay half.</div>
          </div>
        </div>
        <div class="item">
          <span style={{ fontSize: '22px' }}>⛏</span>
          <div class="grow">
            <div class="spread small"><b>Resource exports</b><b class="good">+{fmt.money(n.exports * 30)}/mo</b></div>
            <div class="tiny muted">Your regions dig up resources and sell them to the world automatically.{mineIncome > 0 ? ` Your mines bring in ${fmt.money(mineIncome)} of this.` : ''}</div>
            <div class="spread tiny" style={{ marginTop: '4px' }}><span>Countries buying from you</span><b class={n.access < 0.8 ? 'warn' : 'good'}>{Math.round(n.access * 100)}%</b></div>
            <Bar v={n.access} color={n.access < 0.8 ? 'var(--warn)' : 'var(--good)'} />
          </div>
        </div>
      </div>
      {best && (
        <div class="card small row" style={{ marginTop: '8px', gap: '10px' }}>
          <span style={{ fontSize: '22px' }}>💡</span>
          <div class="grow">
            Best spot for a new mine: <b>{g.w.provs[best.i].name}</b>
            <div class="good"><b>+{fmt.money(best.gain)} a month</b> for {fmt.money(best.cost)} · pays for itself in {Math.ceil(paybackMonths(best.cost, best.gain))} months</div>
          </div>
          <button class="btn sm primary" onClick={() => c.startBuild('mine')}>Build</button>
        </div>
      )}
      {blockers.length > 0 && (
        <div class="card small" style={{ marginTop: '8px' }}>
          🚫 <b>Not buying from you:</b>{' '}
          {blockers.slice(0, 12).map((m) => <span class="chip click" style={{ margin: '2px' }} onClick={() => c.open('world', m.idx)}><NationDot color={m.color} /> {m.name} {g.atWar(m.idx, me) ? '⚔️' : ''}</span>)}
          <div class="tiny muted" style={{ marginTop: '4px' }}>Countries at war with you or that put an embargo on you don't buy your resources. Make peace or improve relations to get them back.</div>
        </div>
      )}
      <div class="section">📈 World resource price: {Math.round(price * 100)}%</div>
      <Spark values={g.s.priceHist.length > 1 ? g.s.priceHist : [1, price]} color={price >= 1 ? '#4ade80' : '#f87171'} />
      <Help>Prices go up and down. Booms and crashes make the headlines!</Help>

      <Goals />
    </Sheet>
  );
}

function Goals() {
  const c = useCtl();
  const g = c.game!;
  const s = g.s;
  const me = s.player;
  const v = s.settings.victory;
  const goal = SCENARIO_BY_ID[s.scenario]?.goal;
  const region = s.settings.region ? (o: number) => s.nations[o].active : undefined;
  const rows: { icon: string; label: string; value: string; v: number }[] = [];
  if (v.conquest > 0) {
    const share = worldShare(g, me, region);
    rows.push({ icon: '⚔️', label: `Control ${Math.round(v.conquest * 100)}% of ${s.settings.region ?? 'the world'}`, value: `${(share * 100).toFixed(1)}%`, v: share / v.conquest });
  }
  if (goal?.kind === 'continent') {
    const sh = continentShare(g, me, goal.cont);
    rows.push({ icon: '🎯', label: `Control ${Math.round(goal.share * 100)}% of ${goal.cont}`, value: `${Math.round(sh * 100)}%`, v: sh / goal.share });
  }
  if (goal?.kind === 'gdp_rank') rows.push({ icon: '🎯', label: `Reach the top ${goal.rank} incomes`, value: `#${incomeRank(g, me)}`, v: Math.min(1, goal.rank / incomeRank(g, me)) });
  if (goal?.kind === 'survive') rows.push({ icon: '🎯', label: `Hold your capital for ${goal.years} years`, value: `${(g.day / 365).toFixed(1)}y`, v: g.day / 365 / goal.years });
  const sc = scores(g);
  const rank = sc.findIndex((x) => x.n === me) + 1;
  rows.push({ icon: '🏆', label: 'Your world ranking', value: `#${rank}`, v: Math.max(0.05, 1 - (rank - 1) / 10) });
  return (
    <>
      <div class="section">🏆 How to win</div>
      <div class="list">
        {rows.map((r) => (
          <div class="item">
            <span style={{ fontSize: '18px' }}>{r.icon}</span>
            <div class="grow">
              <div class="spread small"><span>{r.label}</span><b>{r.value}</b></div>
              <Bar v={r.v} color="var(--gold)" />
            </div>
          </div>
        ))}
      </div>
      <div class="tiny muted" style={{ marginTop: '6px' }}>Or be in the top 3 when the era ends in {v.endYear}.</div>
    </>
  );
}
