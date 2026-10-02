import { useState } from 'preact/hooks';
import type { Game } from '../../sim/ctx';
import { breakTreaty, cededRegions, declareWar, evaluate, improveRelations, militaryPower, propose, regionCount, relationsCost, warOf } from '../../sim/diplomacy';
import type { PeaceTerms, ProposalKind } from '../../sim/types';
import { Action, Bar, fmt, Help, Likely, NationDot, relColor, Sheet } from '../common';
import { useCtl } from '../controller';

function feeling(r: number) {
  return r > 60 ? 'are close friends' : r > 25 ? 'like you' : r > -10 ? 'are neutral' : r > -50 ? 'distrust you' : 'hate you';
}

export function WorldPanel() {
  const c = useCtl();
  const g = c.game!;
  const me = g.s.player;
  if (c.panelArg !== null && c.panelArg !== me && g.s.nations[c.panelArg]) return <CountryView idx={c.panelArg} />;
  const myWars = g.s.wars.filter((w) => w.att.includes(me) || w.def.includes(me));
  const bloc = g.blocOf(me);
  return (
    <Sheet title="🌍 World" onClose={() => c.open(null)} tall>
      <div class="section">⚔️ Your wars</div>
      {!myWars.length && <div class="small muted">You are at peace.</div>}
      <div class="list">
        {myWars.map((w) => {
          const score = w.att.includes(me) ? w.score : -w.score;
          const foe = w.att.includes(me) ? w.def[0] : w.att[0];
          return (
            <div class="item click" onClick={() => c.open('world', foe)}>
              <div class="grow">
                <div class="small"><b>{w.name}</b></div>
                <div class="tiny muted">vs {(w.att.includes(me) ? w.def : w.att).map((x) => g.name(x)).join(', ')}</div>
                <Bar v={(score + 100) / 200} color={score >= 0 ? 'var(--good)' : 'var(--bad)'} />
                <div class={'tiny ' + (score > 15 ? 'good' : score < -15 ? 'bad' : 'muted')}>{score > 15 ? 'You are winning' : score < -15 ? 'You are losing' : 'Stalemate'} · tap to talk peace</div>
              </div>
            </div>
          );
        })}
      </div>
      {bloc && (
        <>
          <div class="section">🛡 Your alliance: {bloc.name}</div>
          <div class="row wrap">{bloc.members.filter((m) => m !== me).map((m) => <span class="chip click" onClick={() => c.open('world', m)}><NationDot color={g.s.nations[m].color} /> {g.name(m)}</span>)}</div>
        </>
      )}
      <div class="section">🌐 Countries</div>
      <NationList g={g} onPick={(i) => c.open('world', i)} />
    </Sheet>
  );
}

function NationList({ g, onPick }: { g: Game; onPick: (i: number) => void }) {
  const [q, setQ] = useState('');
  const me = g.s.player;
  const list = g.s.nations
    .filter((n) => n.alive && n.active && n.idx !== me && n.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Math.abs(g.rel(me, b.idx)) + b.income * 20 - (Math.abs(g.rel(me, a.idx)) + a.income * 20));
  return (
    <>
      <input type="search" placeholder="🔍 Find a country…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <div class="list" style={{ marginTop: '8px' }}>
        {list.slice(0, 40).map((n) => {
          const r = g.rel(me, n.idx);
          return (
            <div class="item click" onClick={() => onPick(n.idx)}>
              <NationDot color={n.color} />
              <div class="grow">
                <div class="spread"><span class="ellipsis">{n.name}</span><span class="tiny" style={{ color: relColor(r) }}>{feeling(r)}</span></div>
                <div class="row" style={{ gap: '4px' }}>
                  {g.atWar(me, n.idx) && <span class="chip bad">At war</span>}
                  {g.allied(me, n.idx) && <span class="chip good">Ally</span>}
                  {g.hasPair(g.s.trade, me, n.idx) && <span class="chip">Trade</span>}
                  {g.hasPair(g.s.nap, me, n.idx) && <span class="chip">No attack</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function CountryView({ idx }: { idx: number }) {
  const c = useCtl();
  const g = c.game!;
  const me = g.s.player;
  const n = g.s.nations[idx];
  const r = g.rel(me, idx);
  const war = warOf(g, me, idx);
  const [msg, setMsg] = useState<string | null>(null);
  const likely = (kind: ProposalKind, terms?: PeaceTerms) => evaluate(g, kind, me, idx, terms, { war: war?.id })[0];
  const act = (kind: ProposalKind, terms?: PeaceTerms) => {
    const out = propose(g, me, idx, kind, terms, { war: war?.id });
    setMsg(out.ok ? `✅ ${n.name} agreed.` : `❌ ${n.name} said no: ${out.reason}`);
    c.renderer?.invalidate(true);
    c.emit();
  };
  const theirs = militaryPower(g, idx), mine = militaryPower(g, me);
  const myScore = war ? (war.att.includes(me) ? war.score : -war.score) : 0;
  const taking = war ? cededRegions(g, idx, me, { kind: 'cede' }).length : 0;
  const allied = g.allied(me, idx) && !war;
  return (
    <Sheet title={<span class="row"><NationDot color={n.color} /> {n.name}</span>} onClose={() => c.open(null)} tall right={<button class="btn sm" onClick={() => c.open('world')}>‹ All</button>}>
      <div class="small">They <b style={{ color: relColor(r) }}>{feeling(r)}</b>.</div>
      <Bar v={(r + 100) / 200} color={relColor(r)} />
      <div class="grid3" style={{ marginTop: '8px' }}>
        <div class="stat"><div class="l">Income</div><div class="v">{fmt.money(n.income * 30)}</div><div class="tiny muted">a month</div></div>
        <div class="stat"><div class="l">Military</div><div class={'v ' + (theirs > mine ? 'bad' : 'good')}>{theirs > mine * 1.5 ? 'Stronger' : theirs < mine / 1.5 ? 'Weaker' : 'Similar'}</div><div class="tiny muted">than you</div></div>
        <div class="stat"><div class="l">Regions</div><div class="v">{regionCount(g, idx)}</div><div class="tiny muted ellipsis">{g.blocOf(idx)?.name ?? 'no alliance'}</div></div>
      </div>
      <button class="btn sm block" style={{ marginTop: '8px' }} onClick={() => { if (n.capital >= 0) c.focus(n.capital); c.open(null); }}>📍 Show on map</button>
      {msg && <div class="card small" style={{ marginTop: '8px' }}>{msg}</div>}

      {war ? (
        <>
          <div class="section">⚔️ At war — {myScore > 15 ? 'you are winning' : myScore < -15 ? 'you are losing' : 'stalemate'}</div>
          <Bar v={(myScore + 100) / 200} color={myScore >= 0 ? 'var(--good)' : 'var(--bad)'} />
          <div class="list" style={{ marginTop: '8px' }}>
            <Action icon="🕊" title="Offer peace" desc="The war ends and everyone keeps their old borders." onClick={() => act('peace', { kind: 'white' })}><Likely ok={likely('peace', { kind: 'white' })} /></Action>
            <Action icon="🗺" title="Peace — and keep what you took" desc={taking ? `You keep the ${taking} region${taking > 1 ? 's' : ''} you hold.` : 'You hold none of their land yet.'} onClick={() => act('peace', { kind: 'cede' })}><Likely ok={likely('peace', { kind: 'cede' })} /></Action>
          </div>
          <Help>Capture their regions — especially their capital ★ — to make them accept. If they lose most of their land they surrender completely.</Help>
        </>
      ) : (
        <>
          <div class="section">🤝 Diplomacy</div>
          <div class="list">
            <Action icon="💐" title="Improve relations" desc={`Gifts and visits. Costs ${fmt.money(relationsCost(g, me))}.`} onClick={() => { const e = improveRelations(g, me, idx); setMsg(e ?? `${n.name} likes you more.`); c.emit(); }} />
            {!g.hasPair(g.s.trade, me, idx) && <Action icon="📦" title="Trade deal" desc="+3% income for both of you." onClick={() => act('trade')}><Likely ok={likely('trade')} /></Action>}
            {!g.hasPair(g.s.nap, me, idx) && !allied && <Action icon="🕊" title="Promise not to attack" desc="Neither of you may attack the other without breaking it." onClick={() => act('nap')}><Likely ok={likely('nap')} /></Action>}
            {!allied && <Action icon="🛡" title="Alliance" desc="You fight together: if one is attacked, the other joins." onClick={() => act('alliance')}><Likely ok={likely('alliance')} /></Action>}
            {allied && <Action icon="💔" title="Leave your alliance" desc="You will no longer defend each other." onClick={() => { breakTreaty(g, me, idx, 'alliance'); setMsg('You left the alliance.'); c.emit(); }} />}
            {g.hasPair(g.s.trade, me, idx) && <Action icon="✂️" title="Cancel trade deal" desc="Both of you lose the bonus." onClick={() => { breakTreaty(g, me, idx, 'trade'); c.emit(); }} />}
          </div>
          {!allied && (
            <>
              <div class="section">⚔️ War</div>
              <Action icon="⚔️" tone="bad" title={`Declare war on ${n.name}`} desc={`${g.blocOf(idx) ? `Their allies (${g.blocOf(idx)!.name}) will likely join. ` : ''}${g.hasPair(g.s.nap, me, idx) ? 'You promised not to attack them — everyone will trust you less.' : r > -30 ? 'Others will trust you a little less.' : 'They are already your enemy.'}`}
                onClick={() => {
                  if (!confirm(`Declare war on ${n.name}?`)) return;
                  const e = declareWar(g, me, idx);
                  setMsg(e ?? `⚔️ War! Select your troops and drag them onto ${n.name}'s regions.`);
                  c.renderer?.invalidate(true);
                  c.emit();
                }} />
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
