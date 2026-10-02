import { useState } from 'preact/hooks';
import { BASE_PRICE, RES_ICONS, RES_NAMES } from '../../data/countries';
import { interestRate, marketAccess, productionCapacity, unitUpkeep } from '../../sim/economy';
import { RESOURCES, type Resource } from '../../sim/types';
import { Bar, fmt, Sheet, Slider, Stat, Tabs, Toggle } from '../common';
import { useCtl } from '../controller';

export function EconomyPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const [tab, setTab] = useState<'budget' | 'resources' | 'market'>('budget');
  const close = () => { c.panel = null; c.emit(); };
  const upkeep = unitUpkeep(g, n);
  const milBudget = (n.gdp * n.budget.military) / 365;
  const bal = n.income + n.tradeIncome - n.expense;
  const setSector = (k: keyof typeof n.sectors, v: number) => {
    const others = (Object.keys(n.sectors) as (keyof typeof n.sectors)[]).filter((x) => x !== k);
    const rest = others.reduce((a, x) => a + n.sectors[x], 0) || 1;
    n.sectors[k] = v;
    for (const x of others) n.sectors[x] = (n.sectors[x] / rest) * (1 - v);
    c.emit();
  };
  return (
    <Sheet title="💰 Economy" onClose={close} tall>
      <div class="grid3">
        <Stat label="GDP" value={fmt.money(n.gdp)} sub={<span class={n.growth >= 0 ? 'good' : 'bad'}>{fmt.signed(n.growth)}%/yr</span>} />
        <Stat label="Treasury" value={fmt.money(n.treasury)} sub={<span class={bal >= 0 ? 'good' : 'bad'}>{fmt.signed(bal * 365, 0)}B/yr</span>} />
        <Stat label="Debt" value={fmt.pct(n.debt / n.gdp)} sub={`${fmt.pct(interestRate(g, n), 1)} interest`} cls={n.debt / n.gdp > 1.2 ? 'warn' : ''} />
        <Stat label="Inflation" value={n.inflation.toFixed(1) + '%'} cls={n.inflation > 8 ? 'bad' : n.inflation > 4 ? 'warn' : ''} />
        <Stat label="Market access" value={fmt.pct(marketAccess(g, n.idx))} cls={marketAccess(g, n.idx) < 0.7 ? 'bad' : ''} sub={n.blockade > 0.05 ? `🚫 ${fmt.pct(n.blockade)} blockaded` : 'open sea lanes'} />
        <Stat label="Manpower" value={fmt.num(n.manpower) + 'k'} />
      </div>
      {n.creditCrisis > 0 && <div class="card bad small" style={{ marginTop: '8px' }}>⚠️ Credit crisis: you cannot borrow for {n.creditCrisis} more days. Deficits cause unrest.</div>}
      <div style={{ margin: '12px 0 6px' }}>
        <Tabs tabs={[['budget', 'Budget'], ['resources', 'Resources'], ['market', 'World market']]} value={tab} onChange={setTab} />
      </div>
      {tab === 'budget' && (
        <div class="col">
          <Slider label="Tax rate (share of GDP)" value={n.taxRate} min={0.05} max={0.6} step={0.01} display={fmt.pct(n.taxRate)} onInput={(v) => { n.taxRate = v; c.emit(); }} />
          <div class="tiny muted">Higher taxes cut approval above 30%.</div>
          <div class="section">Spending (share of GDP)</div>
          <Slider label="🪖 Military" value={n.budget.military} min={0} max={0.2} step={0.002} display={`${fmt.pct(n.budget.military, 1)} · ${fmt.money(milBudget * 365)}/yr`} onInput={(v) => { n.budget.military = v; c.emit(); }} />
          <div class="tiny muted">Upkeep {fmt.money(upkeep * 365)}/yr ({fmt.pct(n.readiness)} funded) · factories can absorb {fmt.money(productionCapacity(g, n) * 365)}/yr</div>
          <Slider label="🛣 Infrastructure" value={n.budget.infrastructure} min={0} max={0.1} step={0.002} display={fmt.pct(n.budget.infrastructure, 1)} onInput={(v) => { n.budget.infrastructure = v; c.emit(); }} />
          <Slider label="🔬 Research" value={n.budget.research} min={0} max={0.08} step={0.001} display={fmt.pct(n.budget.research, 1)} onInput={(v) => { n.budget.research = v; c.emit(); }} />
          <Slider label="🏥 Welfare" value={n.budget.welfare} min={0} max={0.35} step={0.005} display={fmt.pct(n.budget.welfare, 1)} onInput={(v) => { n.budget.welfare = v; c.emit(); }} />
          <div class="card small">
            <div class="spread"><span>Revenue</span><b class="good">{fmt.money(n.income * 365)}/yr</b></div>
            <div class="spread"><span>Trade balance</span><b class={n.tradeIncome >= 0 ? 'good' : 'bad'}>{fmt.money(n.tradeIncome * 365)}/yr</b></div>
            <div class="spread"><span>Spending + interest</span><b class="bad">{fmt.money(n.expense * 365)}/yr</b></div>
          </div>
          <div class="section">Economic sectors (investment focus)</div>
          {(['agri', 'industry', 'tech', 'services'] as const).map((k) => (
            <Slider
              label={{ agri: '🌾 Agriculture → food', industry: '🏭 Industry → steel & arms production', tech: '💾 Technology → electronics & research', services: '🏦 Services → growth & taxes' }[k]}
              value={n.sectors[k]}
              min={0.01}
              max={0.8}
              step={0.01}
              display={fmt.pct(n.sectors[k])}
              onInput={(v) => setSector(k, v)}
            />
          ))}
          <Toggle label="🏭 War economy" desc="+75% military production, −1.5% growth, −5 approval." on={n.warEconomy} onChange={(v) => { n.warEconomy = v; c.emit(); }} />
        </div>
      )}
      {tab === 'resources' && (
        <div class="list">
          {RESOURCES.map((r: Resource) => {
            const net = n.prod[r] - n.cons[r];
            const days = n.cons[r] > 0 ? n.stock[r] / n.cons[r] : 999;
            return (
              <div class="item">
                <span style={{ fontSize: '20px' }}>{RES_ICONS[r]}</span>
                <div class="grow">
                  <div class="spread">
                    <b>{RES_NAMES[r]}</b>
                    <span class={net >= 0 ? 'good small' : 'bad small'}>{fmt.signed(net, 2)}/day</span>
                  </div>
                  <div class="tiny muted">
                    Prod {n.prod[r].toFixed(2)} · Use {n.cons[r].toFixed(2)} · Stock {Math.round(days)} days
                    {n.shortage[r] > 0.05 ? <span class="bad"> · SHORTAGE {fmt.pct(n.shortage[r])}</span> : null}
                  </div>
                  <Bar v={Math.min(1, days / 60)} color={days < 10 ? 'var(--bad)' : days < 25 ? 'var(--warn)' : 'var(--good)'} h={4} />
                </div>
                <button
                  class={'btn sm' + (n.noExport.includes(r) ? ' on' : '')}
                  title="Ban exports"
                  onClick={() => { n.noExport = n.noExport.includes(r) ? n.noExport.filter((x) => x !== r) : [...n.noExport, r]; c.emit(); }}
                >
                  {n.noExport.includes(r) ? '🚫 No export' : 'Export'}
                </button>
              </div>
            );
          })}
          <div class="tiny muted">Shortages: oil slows armies, food causes unrest and famine, steel slows production, electronics slow research, rare earths & uranium limit advanced weapons and nukes.</div>
        </div>
      )}
      {tab === 'market' && (
        <div class="list">
          {RESOURCES.map((r) => {
            const rel = g.s.price[r] / BASE_PRICE[r];
            return (
              <div class="item">
                <span style={{ fontSize: '20px' }}>{RES_ICONS[r]}</span>
                <div class="grow">
                  <b>{RES_NAMES[r]}</b>
                  <div class="tiny muted">{fmt.money(g.s.price[r] * 1000)} per 1k units</div>
                </div>
                <b class={rel > 1.3 ? 'bad' : rel < 0.8 ? 'good' : ''}>{rel >= 1 ? '▲' : '▼'} {fmt.pct(rel)}</b>
              </div>
            );
          })}
          <div class="section">Your trade agreements</div>
          <div class="row wrap">
            {g.s.trade.filter((k) => k.split('|').map(Number).includes(n.idx)).map((k) => {
              const o = k.split('|').map(Number).find((x) => x !== n.idx)!;
              return <span class="chip good">🤝 {g.name(o)}</span>;
            })}
            {g.s.sanctions.filter((k) => k.endsWith('>' + n.idx)).map((k) => <span class="chip bad">🚫 sanctioned by {g.name(+k.split('>')[0])}</span>)}
          </div>
        </div>
      )}
    </Sheet>
  );
}
