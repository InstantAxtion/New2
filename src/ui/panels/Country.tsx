import { SCENARIO_BY_ID } from '../../data/scenarios';
import { RES_INFO } from '../../data/units';
import { regionCount } from '../../sim/diplomacy';
import { buyPrice, sellPrice, storage, trade, tradeBonus } from '../../sim/economy';
import type { Resource } from '../../sim/types';
import { RESOURCES } from '../../sim/types';
import { continentShare, incomeRank, scores, worldShare } from '../../sim/victory';
import { Bar, fmt, Help, Sheet } from '../common';
import { useCtl } from '../controller';

export function CountryPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const me = g.s.player;
  const cap = storage(g, me);
  const net = n.income - n.upkeep;
  const deals = Math.round(tradeBonus(g, me) * 100);
  const deal = (r: Resource, q: number) => {
    const e = trade(g, me, r, q);
    if (e) c.toast(e, 'warn');
    c.emit();
  };
  return (
    <Sheet title={`🏛 ${n.name}`} onClose={() => c.open(null)} tall>
      <div class="section">💰 Money</div>
      <div class="grid3">
        <div class="stat"><div class="l">Treasury</div><div class="v">{fmt.money(n.money)}</div></div>
        <div class="stat"><div class="l">Income</div><div class="v good">+{fmt.money(n.income * 30)}</div><div class="tiny muted">a month</div></div>
        <div class="stat"><div class="l">Army upkeep</div><div class="v bad">−{fmt.money(n.upkeep * 30)}</div><div class="tiny muted">a month</div></div>
      </div>
      <div class={'small ' + (net >= 0 ? 'good' : 'bad')} style={{ marginTop: '6px' }}>
        {net >= 0 ? `You save ${fmt.money(net * 30)} a month.` : `You lose ${fmt.money(-net * 30)} a month — when money runs out your troops start to desert.`}
      </div>
      <Help>Money comes from your {regionCount(g, me)} regions (bigger, richer regions pay more; captured ones pay half). Factories add +10% in their region{deals ? `, and your trade deals add +${deals}%` : ''}. Every unit costs upkeep.</Help>

      <div class="section">📦 Resources</div>
      <div class="list">
        {RESOURCES.map((r) => (
          <div class="card">
            <div class="spread">
              <b>{RES_INFO[r].icon} {RES_INFO[r].name}</b>
              <span class="small"><b>{Math.floor(n.res[r])}</b><span class="muted"> / {cap[r]}</span> <span class="good">+{n.made[r].toFixed(1)}/day</span></span>
            </div>
            <Bar v={n.res[r] / cap[r]} color={r === 'ammo' ? '#f59e0b' : r === 'uranium' ? '#a3e635' : '#a8a29e'} />
            <div class="tiny muted" style={{ marginTop: '4px' }}>{RES_INFO[r].desc}</div>
            <div class="row wrap" style={{ marginTop: '6px' }}>
              <span class="tiny muted grow">Market: buy {fmt.money(buyPrice(g, r))} · sell {fmt.money(sellPrice(g, r))}</span>
              <button class="btn sm" onClick={() => deal(r, 10)}>Buy 10</button>
              <button class="btn sm" onClick={() => deal(r, 50)}>Buy 50</button>
              <button class="btn sm" disabled={n.res[r] < 10} onClick={() => deal(r, -10)}>Sell 10</button>
            </div>
          </div>
        ))}
      </div>
      <Help>Storage grows with your land and army. Anything above the limit is lost, so sell the extra.</Help>

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
