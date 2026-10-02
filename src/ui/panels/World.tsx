import { useState } from 'preact/hooks';
import { OP_BY_KIND, opCost, recruitSpy, startOp, successChance } from '../../sim/covert';
import type { Game } from '../../sim/ctx';
import { declareWar, evaluate, improveRelations, militaryPower, propose, respondMessage, setSanction, warOf } from '../../sim/diplomacy';
import type { OpKind, PeaceTerms, ProposalKind } from '../../sim/types';
import { councilName, playerVote, RES_INFO } from '../../sim/un';
import { Action, Bar, dateStr, fmt, Help, Likely, NationDot, relColor, Sheet } from '../common';
import { useCtl } from '../controller';

function feeling(r: number) {
  return r > 60 ? 'are close friends' : r > 25 ? 'like you' : r > -10 ? 'are neutral' : r > -50 ? 'distrust you' : 'hate you';
}

export function WorldPanel() {
  const c = useCtl();
  const g = c.game!;
  const me = g.s.player;
  const close = () => c.open(null);
  if (c.panelArg !== null && c.panelArg !== me && g.s.nations[c.panelArg]) return <CountryView idx={c.panelArg} />;
  const inbox = g.s.inbox.filter((m) => !m.resolved && m.to === me);
  const myWars = g.s.wars.filter((w) => w.att.includes(me) || w.def.includes(me));
  const vote = g.s.un.res.find((r) => !r.resolved);
  return (
    <Sheet title="🌍 World" onClose={close} tall>
      {inbox.length > 0 && (
        <>
          <div class="section">📨 Messages for you ({inbox.length})</div>
          <Inbox g={g} />
        </>
      )}
      {vote && (
        <>
          <div class="section">🏛 {councilName(g)} vote</div>
          <div class="card">
            <b>{RES_INFO[vote.kind].name}: {vote.kind === 'peacekeep' ? g.s.wars.find((w) => w.id === vote.target)?.name : g.name(vote.target)}</b>
            <div class="tiny muted">{RES_INFO[vote.kind].desc} Closes in {vote.voteDay - g.day} days.</div>
            <div class="row" style={{ marginTop: '6px' }}>
              {(['yes', 'no', 'abstain'] as const).map((v) => (
                <button class={'btn sm' + (vote[v].includes(me) ? ' on' : '')} onClick={() => { playerVote(g, vote.id, v); c.emit(); }}>
                  {v === 'yes' ? '👍 Yes' : v === 'no' ? (g.s.un.permanent.includes(me) ? '🚫 Veto' : '👎 No') : 'Abstain'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
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
                <div class={'tiny ' + (score > 15 ? 'good' : score < -15 ? 'bad' : 'muted')}>{score > 15 ? 'You are winning' : score < -15 ? 'You are losing' : 'Stalemate'} · tap for peace talks</div>
              </div>
            </div>
          );
        })}
      </div>
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
    .sort((a, b) => Math.abs(g.rel(me, b.idx)) + b.gdp / 500 - (Math.abs(g.rel(me, a.idx)) + a.gdp / 500));
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
                  {g.sanctioned(me, n.idx) && <span class="chip bad">Sanctioned</span>}
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
  const [demand, setDemand] = useState(false);
  const [picks, setPicks] = useState<number[]>([]);
  const likely = (kind: ProposalKind, terms?: PeaceTerms) => evaluate(g, kind, me, idx, terms, { war: war?.id })[0];
  const act = (kind: ProposalKind, terms?: PeaceTerms) => {
    const out = propose(g, me, idx, kind, terms, { war: war?.id });
    setMsg(out.ok ? `✅ ${n.name} agreed.` : `❌ ${n.name} refused: ${out.reason}`);
    c.renderer?.invalidate(true);
    c.emit();
  };
  const spy = (k: OpKind) => {
    const e = startOp(g, me, idx, k);
    setMsg(e ?? `🕵️ Agents sent. You'll hear back in ${OP_BY_KIND[k].days} days.`);
    c.emit();
  };
  const theirPower = militaryPower(g, idx), myPower = militaryPower(g, me);
  const border = g.s.provinces.map((p, i) => (p.owner === idx && p.ctrl === idx && i !== n.capital && g.w.provs[i].nb.some((q) => g.s.provinces[q].ctrl === me) ? i : -1)).filter((i) => i >= 0);
  const myScore = war ? (war.att.includes(me) ? war.score : -war.score) : 0;
  return (
    <Sheet title={<span class="row"><NationDot color={n.color} /> {n.name}</span>} onClose={() => c.open(null)} tall right={<button class="btn sm" onClick={() => c.open('world')}>‹ All</button>}>
      <div class="small">They <b style={{ color: relColor(r) }}>{feeling(r)}</b>.</div>
      <Bar v={(r + 100) / 200} color={relColor(r)} />
      <div class="grid3" style={{ marginTop: '8px' }}>
        <div class="stat"><div class="l">Economy</div><div class="v">{fmt.money(n.gdp)}</div></div>
        <div class="stat"><div class="l">Military</div><div class={'v ' + (theirPower > myPower ? 'bad' : 'good')}>{theirPower > myPower * 1.5 ? 'Stronger' : theirPower < myPower / 1.5 ? 'Weaker' : 'Similar'}</div><div class="tiny muted">than you</div></div>
        <div class="stat"><div class="l">Allies</div><div class="v" style={{ fontSize: '13px' }}>{g.blocOf(idx)?.name ?? 'None'}</div></div>
      </div>
      {msg && <div class="card small" style={{ marginTop: '8px' }}>{msg}</div>}

      {war ? (
        <>
          <div class="section">⚔️ At war — {myScore > 15 ? 'you are winning' : myScore < -15 ? 'you are losing' : 'stalemate'}</div>
          <Bar v={(myScore + 100) / 200} color={myScore >= 0 ? 'var(--good)' : 'var(--bad)'} />
          <div class="list" style={{ marginTop: '8px' }}>
            <Action icon="🕊" title="Offer peace" desc="End the war. Everyone keeps their original borders." onClick={() => act('peace', { kind: 'white' })}><Likely ok={likely('peace', { kind: 'white' })} /></Action>
            <Action icon="🗺" title="Demand the land you hold" desc="Peace, and you keep the provinces you occupy." onClick={() => act('peace', { kind: 'cede' })}><Likely ok={likely('peace', { kind: 'cede' })} /></Action>
            <Action icon="👑" title="Make them your vassal" desc="They obey you and fight in your wars." onClick={() => act('peace', { kind: 'vassal' })}><Likely ok={likely('peace', { kind: 'vassal' })} /></Action>
          </div>
          <Help>Capture their land (especially their capital) to make them accept harsher terms.</Help>
        </>
      ) : (
        <>
          <div class="section">🤝 Make friends</div>
          <div class="list">
            <Action icon="💐" title="Improve relations" desc={`Gifts and state visits. Costs ${fmt.money(Math.max(0.2, g.player.gdp * 0.0004))}.`} onClick={() => { const e = improveRelations(g, me, idx); setMsg(e ?? `${n.name} likes you a little more.`); c.emit(); }} />
            {!g.hasPair(g.s.trade, me, idx) && <Action icon="📦" title="Trade deal" desc="Both economies grow faster." onClick={() => act('trade')}><Likely ok={likely('trade')} /></Action>}
            {!g.hasPair(g.s.nap, me, idx) && !g.allied(me, idx) && <Action icon="🕊" title="Non-aggression pact" desc="You both promise not to attack each other." onClick={() => act('nap')}><Likely ok={likely('nap')} /></Action>}
            {!g.allied(me, idx) && <Action icon="🛡" title="Alliance" desc="You defend each other if attacked." onClick={() => act('alliance')}><Likely ok={likely('alliance')} /></Action>}
          </div>
          <div class="section">😠 Put on pressure</div>
          <div class="list">
            <Action icon="🚫" title={g.sanctioned(me, idx) ? 'Lift sanctions' : 'Sanctions'} desc="Hurts their economy and trade. They will dislike you." onClick={() => { setSanction(g, me, idx, !g.sanctioned(me, idx)); c.emit(); }} />
            {border.length > 0 && <Action icon="🗺" title="Demand land" desc="Threaten them into handing over border provinces." onClick={() => setDemand(!demand)}><Likely ok={likely('demand')} /></Action>}
          </div>
          {demand && (
            <div class="card" style={{ marginTop: '8px' }}>
              <div class="small">Which provinces?</div>
              <div class="row wrap" style={{ marginTop: '6px' }}>
                {border.map((p) => (
                  <button class={'btn sm' + (picks.includes(p) ? ' on' : '')} onClick={() => setPicks(picks.includes(p) ? picks.filter((x) => x !== p) : [...picks, p])}>{g.w.provs[p].name}</button>
                ))}
              </div>
              <button class="btn sm danger" style={{ marginTop: '6px' }} disabled={!picks.length} onClick={() => { act('demand', { kind: 'cede', provinces: picks }); setPicks([]); setDemand(false); }}>Send the demand</button>
            </div>
          )}
        </>
      )}

      <div class="section">🕵️ Spies <span class="tiny muted" style={{ textTransform: 'none', letterSpacing: 0 }}>({g.player.spies} available)</span></div>
      <div class="list">
        {(['sabotage', 'steal_tech', 'incite'] as OpKind[]).map((k) => (
          <Action icon={k === 'sabotage' ? '💥' : k === 'steal_tech' ? '📂' : '🔥'} title={OP_BY_KIND[k].name} desc={`${OP_BY_KIND[k].desc} ${Math.round(successChance(g, me, idx, k) * 100)}% chance · ${fmt.money(opCost(g, me, k))}`} onClick={() => spy(k)} />
        ))}
        <Action icon="➕" title="Train a new spy" desc="More spies = more missions at once." onClick={() => { const e = recruitSpy(g, me); setMsg(e ?? 'A new spy is ready.'); c.emit(); }} />
      </div>
      <Help>If a spy is caught, the target will be angry with you.</Help>

      {!war && !g.allied(me, idx) && (
        <>
          <div class="section">⚔️ War</div>
          <Action
            icon="⚔️"
            tone="bad"
            title={`Declare war on ${n.name}`}
            desc={`${g.blocOf(idx) ? `Their alliance (${g.blocOf(idx)!.name}) will likely join them. ` : ''}${r > -30 ? 'Without a good reason, the world will trust you less.' : 'They are already your enemy.'}`}
            onClick={() => {
              if (!confirm(`Declare war on ${n.name}?`)) return;
              const e = declareWar(g, me, idx);
              setMsg(e ?? `⚔️ You are now at war with ${n.name}. Select your units and attack their provinces.`);
              c.renderer?.invalidate(true);
              c.emit();
            }}
          />
        </>
      )}
    </Sheet>
  );
}

function Inbox({ g }: { g: Game }) {
  const c = useCtl();
  const me = g.s.player;
  const msgs = g.s.inbox.filter((m) => m.to === me && !m.resolved).slice().reverse();
  return (
    <div class="list">
      {msgs.map((m) => {
        const surrender = m.kind === 'peace' && m.terms?.kind === 'annex' && m.from !== me;
        return (
          <div class="card sel">
            <div class="row">
              <NationDot color={g.s.nations[m.from].color} />
              <b class="grow">{g.name(m.from)}</b>
              <span class="tiny muted">{dateStr(g, m.day)}</span>
            </div>
            <div class="small" style={{ marginTop: '4px' }}>{m.text}</div>
            {surrender ? (
              <>
                <div class="tiny muted" style={{ marginTop: '4px' }}>They surrendered. Choose what happens to them:</div>
                <div class="list" style={{ marginTop: '6px' }}>
                  <button class="btn sm" onClick={() => { respondMessage(g, m.id, true, { kind: 'annex' }); c.renderer?.invalidate(true); c.emit(); }}>🏴 Take the whole country</button>
                  <button class="btn sm" onClick={() => { respondMessage(g, m.id, true, { kind: 'cede' }); c.renderer?.invalidate(true); c.emit(); }}>🗺 Keep only the land you hold</button>
                  <button class="btn sm" onClick={() => { respondMessage(g, m.id, true, { kind: 'vassal' }); c.renderer?.invalidate(true); c.emit(); }}>👑 Make them your vassal</button>
                </div>
                <div class="tiny muted">Taking more land makes neighbours fear you and may unite them against you.</div>
              </>
            ) : (
              <div class="row" style={{ marginTop: '6px' }}>
                <button class="btn sm good" onClick={() => { c.toast(respondMessage(g, m.id, true)); c.renderer?.invalidate(true); }}>Accept</button>
                <button class="btn sm" onClick={() => { c.toast(respondMessage(g, m.id, false)); c.renderer?.invalidate(true); }}>Decline</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
