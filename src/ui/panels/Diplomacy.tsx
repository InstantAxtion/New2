import { useState } from 'preact/hooks';
import { RES_NAMES } from '../../data/countries';
import type { Game } from '../../sim/ctx';
import {
  declareWar, evaluate, freezeAssets, improveRelations, leaveBloc, militaryPower, propose, respondMessage, setEmbargo, setSanction, setTariffs, warOf,
} from '../../sim/diplomacy';
import { RESOURCES, type PeaceTerms, type ProposalKind, type ResolutionKind } from '../../sim/types';
import { councilName, playerVote, proposeResolution, RES_INFO } from '../../sim/un';
import { Bar, dateStr, fmt, NationDot, relColor, Sheet, Tabs } from '../common';
import { useCtl } from '../controller';
import { NationCard } from '../NewGame';

type Tab = 'nations' | 'wars' | 'blocs' | 'inbox' | 'un';

export function DiplomacyPanel() {
  const c = useCtl();
  const g = c.game!;
  const me = g.s.player;
  const inbox = g.s.inbox.filter((m) => !m.resolved && m.to === me);
  const [tab, setTab] = useState<Tab>(inbox.length ? 'inbox' : 'nations');
  const close = () => { c.panel = null; c.panelArg = null; c.emit(); };
  if (c.panelArg !== null && c.panelArg !== me && g.s.nations[c.panelArg]) return <NationDetail idx={c.panelArg} onBack={() => { c.panelArg = null; c.emit(); }} onClose={close} />;
  return (
    <Sheet title="🤝 Diplomacy" onClose={close} tall>
      <Tabs<Tab> tabs={[['nations', 'Nations'], ['wars', `Wars (${g.s.wars.length})`], ['blocs', 'Alliances'], ['inbox', `Inbox${inbox.length ? ` (${inbox.length})` : ''}`], ['un', councilName(g).split(' ')[0] === 'United' ? 'UN' : 'Council']]} value={tab} onChange={setTab} />
      <div style={{ marginTop: '10px' }}>
        {tab === 'nations' && <NationList g={g} onPick={(i) => { c.panelArg = i; c.emit(); }} />}
        {tab === 'wars' && <WarList g={g} />}
        {tab === 'blocs' && <Blocs g={g} />}
        {tab === 'inbox' && <Inbox g={g} />}
        {tab === 'un' && <UN g={g} />}
      </div>
    </Sheet>
  );
}

function NationList({ g, onPick }: { g: Game; onPick: (i: number) => void }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'rel' | 'gdp' | 'power'>('rel');
  const me = g.s.player;
  const list = g.s.nations
    .filter((n) => n.alive && n.active && n.idx !== me && n.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === 'rel' ? g.rel(me, b.idx) - g.rel(me, a.idx) : sort === 'gdp' ? b.gdp - a.gdp : militaryPower(g, b.idx) - militaryPower(g, a.idx)));
  return (
    <>
      <input type="search" placeholder="🔍 Search nations…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      <div class="row" style={{ margin: '8px 0' }}>
        {(['rel', 'gdp', 'power'] as const).map((s) => (
          <button class={'btn sm grow' + (sort === s ? ' on' : '')} onClick={() => setSort(s)}>
            {s === 'rel' ? 'Relations' : s === 'gdp' ? 'GDP' : 'Military'}
          </button>
        ))}
      </div>
      <div class="list">
        {list.slice(0, 80).map((n) => {
          const r = g.rel(me, n.idx);
          return (
            <div class="item click" onClick={() => onPick(n.idx)}>
              <NationDot color={n.color} />
              <div class="grow">
                <div class="spread">
                  <span class="ellipsis">{n.name}</span>
                  <span class="small" style={{ color: relColor(r) }}>{r > 0 ? '+' : ''}{Math.round(r)}</span>
                </div>
                <div class="row" style={{ gap: '4px' }}>
                  {g.atWar(me, n.idx) && <span class="chip bad">⚔️ War</span>}
                  {g.allied(me, n.idx) && <span class="chip good">🛡 Ally</span>}
                  {g.hasPair(g.s.trade, me, n.idx) && <span class="chip">🤝 Trade</span>}
                  {g.hasPair(g.s.nap, me, n.idx) && <span class="chip">🕊 NAP</span>}
                  {g.sanctioned(me, n.idx) && <span class="chip bad">🚫</span>}
                  {n.nukes > 0 && <span class="chip warn">☢️</span>}
                  <span class="tiny muted">{fmt.money(n.gdp)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function NationDetail({ idx, onBack, onClose }: { idx: number; onBack: () => void; onClose: () => void }) {
  const c = useCtl();
  const g = c.game!;
  const me = g.s.player;
  const n = g.s.nations[idx];
  const r = g.rel(me, idx);
  const war = warOf(g, me, idx);
  const [res, setRes] = useState<string | null>(null);
  const [demand, setDemand] = useState(false);
  const act = (kind: ProposalKind, terms?: PeaceTerms, extra?: { war?: number; amount?: number }) => {
    const out = propose(g, me, idx, kind, terms, extra);
    setRes(out.ok ? `✅ ${n.name} accepted. ${out.reason}` : `❌ ${n.name} declined: ${out.reason}`);
    c.renderer?.invalidate();
    c.emit();
  };
  const preview = (kind: ProposalKind, terms?: PeaceTerms) => evaluate(g, kind, me, idx, terms, { war: war?.id })[0];
  const border = g.s.provinces.map((p, i) => (p.owner === idx && p.ctrl === idx && i !== n.capital && g.w.provs[i].nb.some((q) => g.s.provinces[q].ctrl === me) ? i : -1)).filter((i) => i >= 0);
  const [picks, setPicks] = useState<number[]>([]);
  return (
    <Sheet title={<span class="row"><NationDot color={n.color} />{n.name}</span>} onClose={onClose} tall right={<button class="btn sm" onClick={onBack}>‹ Back</button>}>
      <div class="spread small">
        <span>Relations</span>
        <b style={{ color: relColor(r) }}>{Math.round(r)}</b>
      </div>
      <Bar v={(r + 100) / 200} color={relColor(r)} />
      <div class="small muted" style={{ marginTop: '4px', textTransform: 'capitalize' }}>{n.gov} · {n.pers} · stability {Math.round(n.stability)}% · infamy {Math.round(n.infamy)}</div>
      <NationCard g={g} idx={idx} />
      {res && <div class="card small" style={{ marginTop: '8px' }}>{res}</div>}

      {war ? (
        <>
          <div class="section">⚔️ {war.name}</div>
          <div class="card small">
            <div class="spread"><span>War score (you)</span><b class={(war.att.includes(me) ? war.score : -war.score) >= 0 ? 'good' : 'bad'}>{Math.round(war.att.includes(me) ? war.score : -war.score)}</b></div>
            <div class="spread"><span>Casualties (you / them)</span><b>{fmt.num(war.att.includes(me) ? war.cas[0] : war.cas[1])}k / {fmt.num(war.att.includes(me) ? war.cas[1] : war.cas[0])}k</b></div>
            <div class="spread"><span>Since</span><b>{dateStr(g, war.start)}</b></div>
          </div>
          <div class="section">Peace offers</div>
          <div class="grid2">
            {([['white', '🕊 White peace'], ['cede', '🗺 Take occupied land'], ['reparations', '💰 Reparations'], ['vassal', '👑 Vassalize'], ['annex', '🏴 Annex']] as [PeaceTerms['kind'], string][]).map(([k, label]) => (
              <button class={'btn sm' + (preview('peace', { kind: k }) ? ' good' : '')} onClick={() => act('peace', { kind: k }, { war: war.id })}>
                {label}
              </button>
            ))}
          </div>
          <div class="tiny muted">Green = they would accept now.</div>
        </>
      ) : (
        <>
          <div class="section">Diplomacy</div>
          <div class="grid2">
            <button class="btn sm" onClick={() => { const e = improveRelations(g, me, idx); setRes(e ?? `Relations with ${n.name} improved.`); c.emit(); }}>💐 Improve relations</button>
            <button class={'btn sm' + (preview('alliance') ? ' good' : '')} disabled={g.allied(me, idx)} onClick={() => act('alliance')}>🛡 Alliance</button>
            <button class={'btn sm' + (preview('trade') ? ' good' : '')} disabled={g.hasPair(g.s.trade, me, idx)} onClick={() => act('trade')}>🤝 Trade deal</button>
            <button class={'btn sm' + (preview('nap') ? ' good' : '')} disabled={g.hasPair(g.s.nap, me, idx)} onClick={() => act('nap')}>🕊 Non-aggression</button>
            <button class={'btn sm' + (preview('access') ? ' good' : '')} disabled={g.s.access.includes(idx + '>' + me)} onClick={() => act('access')}>🚚 Military access</button>
            <button class="btn sm" disabled={g.s.guarantee.includes(me + '>' + idx)} onClick={() => act('guarantee')}>🤲 Guarantee independence</button>
            <button class="btn sm" onClick={() => act('aid', undefined, { amount: Math.max(0.5, g.player.gdp * 0.001) })}>💵 Send aid ({fmt.money(Math.max(0.5, g.player.gdp * 0.001))})</button>
            <button class={'btn sm' + (preview('vassal') ? ' good' : '')} onClick={() => act('vassal')}>👑 Demand vassalage</button>
            <button class="btn sm" disabled={!border.length} onClick={() => setDemand(!demand)}>🗺 Demand territory</button>
            <button class="btn sm danger" disabled={g.allied(me, idx)} onClick={() => { if (confirm(`Declare war on ${n.name}?`)) { const e = declareWar(g, me, idx); setRes(e ?? `⚔️ War declared on ${n.name}!`); c.renderer?.invalidate(); c.emit(); } }}>⚔️ Declare war</button>
          </div>
          {demand && (
            <div class="card" style={{ marginTop: '8px' }}>
              <div class="small">Pick border provinces to demand:</div>
              <div class="row wrap" style={{ marginTop: '6px' }}>
                {border.map((p) => (
                  <button class={'btn sm' + (picks.includes(p) ? ' on' : '')} onClick={() => setPicks(picks.includes(p) ? picks.filter((x) => x !== p) : [...picks, p])}>
                    {g.w.provs[p].name}
                  </button>
                ))}
              </div>
              <button class="btn sm danger" style={{ marginTop: '6px' }} disabled={!picks.length} onClick={() => { act('demand', { kind: 'cede', provinces: picks }); setPicks([]); setDemand(false); }}>
                Send ultimatum
              </button>
            </div>
          )}
        </>
      )}
      <div class="section">Economic pressure</div>
      <div class="grid2">
        <button class={'btn sm' + (g.sanctioned(me, idx) ? ' on' : '')} onClick={() => { setSanction(g, me, idx, !g.sanctioned(me, idx)); c.emit(); }}>
          🚫 {g.sanctioned(me, idx) ? 'Lift sanctions' : 'Impose sanctions'}
        </button>
        <button class={'btn sm' + (g.hasPair(g.s.tariffs, me, idx) ? ' on' : '')} onClick={() => { setTariffs(g, me, idx, !g.hasPair(g.s.tariffs, me, idx)); c.emit(); }}>
          📦 {g.hasPair(g.s.tariffs, me, idx) ? 'Drop tariffs' : 'Tariff war'}
        </button>
        <button class="btn sm" onClick={() => { const amt = freezeAssets(g, me, idx); setRes(`Froze ${fmt.money(amt)} of ${n.name}'s assets.`); c.emit(); }}>🧊 Freeze assets</button>
      </div>
      <div class="small" style={{ marginTop: '8px' }}>Embargo a resource:</div>
      <div class="row wrap" style={{ marginTop: '4px' }}>
        {RESOURCES.map((res) => {
          const on = g.s.embargo.includes(`${me}>${idx}:${res}`);
          return (
            <button class={'btn sm' + (on ? ' on' : '')} onClick={() => { setEmbargo(g, me, idx, res, !on); c.emit(); }}>
              {RES_NAMES[res]}
            </button>
          );
        })}
      </div>
      <div class="section">Treaties</div>
      <div class="row wrap">
        {g.blocOf(idx) && <span class="chip">🛡 {g.blocOf(idx)!.name}</span>}
        {g.s.vassal[idx] !== undefined && <span class="chip">👑 Vassal of {g.name(g.s.vassal[idx])}</span>}
        {g.s.nap.filter((k) => k.split('|').map(Number).includes(idx)).slice(0, 8).map((k) => <span class="chip">🕊 {g.name(k.split('|').map(Number).find((x) => x !== idx)!)}</span>)}
        {g.s.wars.filter((w) => w.att.includes(idx) || w.def.includes(idx)).map((w) => <span class="chip bad">⚔️ {w.name}</span>)}
      </div>
    </Sheet>
  );
}

function WarList({ g }: { g: Game }) {
  const c = useCtl();
  const me = g.s.player;
  if (!g.s.wars.length) return <div class="muted">The world is at peace… for now.</div>;
  return (
    <div class="list">
      {g.s.wars.map((w) => {
        const mine = w.att.includes(me) || w.def.includes(me);
        return (
          <div class={'card' + (mine ? ' sel' : '')}>
            <b>{w.name}</b>
            <div class="small muted">since {dateStr(g, w.start)}</div>
            <div class="small" style={{ marginTop: '6px' }}>
              <span class="bad">Attackers:</span> {w.att.map((x) => g.name(x)).join(', ')}
            </div>
            <div class="small">
              <span class="good">Defenders:</span> {w.def.map((x) => g.name(x)).join(', ')}
            </div>
            <div class="spread small" style={{ marginTop: '6px' }}>
              <span>Score (attackers)</span>
              <b>{Math.round(w.score)}</b>
            </div>
            <Bar v={(w.score + 100) / 200} color={w.score >= 0 ? '#ef4444' : '#22c55e'} />
            <div class="tiny muted">Casualties: {fmt.num(w.cas[0])}k / {fmt.num(w.cas[1])}k</div>
            {mine && (
              <button class="btn sm" style={{ marginTop: '6px' }} onClick={() => { c.panelArg = w.att.includes(me) ? w.def[0] : w.att[0]; c.emit(); }}>
                Negotiate with {g.name(w.att.includes(me) ? w.def[0] : w.att[0])}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Blocs({ g }: { g: Game }) {
  const c = useCtl();
  const me = g.s.player;
  const mine = g.blocOf(me);
  return (
    <div class="list">
      {mine && (
        <div class="card sel">
          <div class="spread">
            <b>🛡 {mine.name}</b>
            <button class="btn sm danger" onClick={() => { if (confirm(`Leave ${mine.name}?`)) { leaveBloc(g, me); c.emit(); } }}>Leave</button>
          </div>
          <div class="small muted">Leader: {g.name(mine.leader)} · {mine.members.length} members</div>
          <div class="row wrap" style={{ marginTop: '6px' }}>{mine.members.map((m) => <span class="chip">{g.name(m)}</span>)}</div>
        </div>
      )}
      {!mine && <div class="small muted">You are not in an alliance. Propose one to a friendly nation from the Nations tab.</div>}
      {g.s.blocs.filter((b) => b !== mine).map((b) => (
        <div class="card">
          <div class="row"><span class="dot" style={{ background: b.color }} /><b>{b.name}</b></div>
          <div class="small muted">Leader: {g.name(b.leader)} · {b.members.length} members</div>
          <div class="tiny" style={{ marginTop: '4px' }}>{b.members.map((m) => g.name(m)).join(', ')}</div>
        </div>
      ))}
    </div>
  );
}

function Inbox({ g }: { g: Game }) {
  const c = useCtl();
  const me = g.s.player;
  const msgs = g.s.inbox.filter((m) => m.to === me).slice().reverse();
  if (!msgs.length) return <div class="muted">No messages from foreign leaders.</div>;
  return (
    <div class="list">
      {msgs.slice(0, 30).map((m) => {
        const surrender = m.kind === 'peace' && m.terms?.kind === 'annex' && m.from !== me;
        return (
          <div class={'card' + (m.resolved ? '' : ' sel')}>
            <div class="row">
              <NationDot color={g.s.nations[m.from].color} />
              <b class="grow">{g.name(m.from)}</b>
              <span class="tiny muted">{dateStr(g, m.day)}</span>
            </div>
            <div class="small" style={{ marginTop: '4px' }}>{m.text}</div>
            {m.resolved ? (
              <div class="tiny muted" style={{ marginTop: '4px' }}>{m.resolved}</div>
            ) : surrender ? (
              <div class="grid2" style={{ marginTop: '6px' }}>
                {([['annex', '🏴 Annex completely'], ['cede', '🗺 Keep occupied land'], ['vassal', '👑 Make vassal'], ['reparations', '💰 Reparations'], ['white', '🕊 Restore them']] as [PeaceTerms['kind'], string][]).map(([k, label]) => (
                  <button class="btn sm" onClick={() => { respondMessage(g, m.id, true, { kind: k }); c.renderer?.invalidate(); c.emit(); }}>{label}</button>
                ))}
              </div>
            ) : (
              <div class="row" style={{ marginTop: '6px' }}>
                <button class="btn sm good" onClick={() => { c.toast(respondMessage(g, m.id, true)); c.renderer?.invalidate(); }}>Accept</button>
                <button class="btn sm" onClick={() => { c.toast(respondMessage(g, m.id, false)); c.renderer?.invalidate(); }}>Decline</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function UN({ g }: { g: Game }) {
  const c = useCtl();
  const me = g.s.player;
  const [kind, setKind] = useState<ResolutionKind>('condemn');
  const [target, setTarget] = useState<number>(-1);
  const open = g.s.un.res.find((r) => !r.resolved);
  const targets = kind === 'peacekeep' ? g.s.wars.map((w) => ({ id: w.id, name: w.name })) : kind === 'secgen' ? [{ id: me, name: g.player.name }] : g.s.nations.filter((n) => n.alive && n.active && n.idx !== me).sort((a, b) => a.name.localeCompare(b.name)).map((n) => ({ id: n.idx, name: n.name }));
  return (
    <div class="col">
      <div class="small muted">
        {councilName(g)} · Secretary-General: <b>{g.s.un.secGen >= 0 ? g.name(g.s.un.secGen) : 'vacant'}</b> · Permanent members (veto): {g.s.un.permanent.map((p) => g.name(p)).join(', ')}
      </div>
      {open ? (
        <div class="card sel">
          <b>{RES_INFO[open.kind].name}: {open.kind === 'peacekeep' ? g.s.wars.find((w) => w.id === open.target)?.name : g.name(open.target)}</b>
          <div class="small muted">{RES_INFO[open.kind].desc}</div>
          <div class="row" style={{ marginTop: '6px' }}>
            {(['yes', 'no', 'abstain'] as const).map((v) => (
              <button class={'btn sm' + (open[v].includes(me) ? ' on' : '')} onClick={() => { playerVote(g, open.id, v); c.emit(); }}>{v}</button>
            ))}
          </div>
        </div>
      ) : (
        <div class="card">
          <b>Propose a resolution</b>
          <select value={kind} onChange={(e) => { setKind((e.target as HTMLSelectElement).value as ResolutionKind); setTarget(-1); }} style={{ marginTop: '6px' }}>
            {(Object.keys(RES_INFO) as ResolutionKind[]).map((k) => <option value={k}>{RES_INFO[k].name}</option>)}
          </select>
          <div class="tiny muted" style={{ margin: '4px 0' }}>{RES_INFO[kind].desc}</div>
          <select value={target} onChange={(e) => setTarget(+(e.target as HTMLSelectElement).value)}>
            <option value={-1}>— choose target —</option>
            {targets.map((t) => <option value={t.id}>{t.name}</option>)}
          </select>
          <button class="btn sm primary" style={{ marginTop: '8px' }} disabled={target < 0 && kind !== 'secgen'} onClick={() => { const e = proposeResolution(g, me, kind, kind === 'secgen' ? me : target); c.toast(e ?? 'Resolution tabled — vote in 10 days', e ? 'warn' : 'good'); }}>
            Table resolution
          </button>
        </div>
      )}
      <div class="section">Recent resolutions</div>
      <div class="list">
        {g.s.un.res.filter((r) => r.resolved).slice(-10).reverse().map((r) => (
          <div class="item small">
            <span class="grow">{RES_INFO[r.kind].name}: {r.kind === 'peacekeep' ? 'war' : g.name(r.target)}</span>
            <b class={r.passed ? 'good' : 'bad'}>{r.veto >= 0 ? `vetoed (${g.name(r.veto)})` : r.passed ? `passed ${r.yes.length}-${r.no.length}` : `failed ${r.yes.length}-${r.no.length}`}</b>
          </div>
        ))}
      </div>
    </div>
  );
}


