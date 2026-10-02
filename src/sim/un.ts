// The world council (UN / League of Nations): resolutions, votes, vetoes, Secretary-General.
import type { Game } from './ctx';
import { setSanction, whitePeace } from './diplomacy';
import type { Resolution, ResolutionKind } from './types';

export function councilName(g: Game) {
  return g.s.startYear < 1920 ? 'Concert of Nations' : g.s.startYear < 1945 ? 'League of Nations' : 'United Nations';
}

export const RES_INFO: Record<ResolutionKind, { name: string; desc: string }> = {
  condemn: { name: 'Condemnation', desc: 'Nations voting yes sour relations with the target; target loses stability.' },
  sanction: { name: 'Sanctions', desc: 'Every nation voting yes imposes economic sanctions on the target.' },
  peacekeep: { name: 'Peacekeeping & Ceasefire', desc: 'Pressure both sides of a war toward a white peace.' },
  disarm: { name: 'Nuclear Disarmament', desc: 'Target must dismantle a third of its warheads or face sanctions.' },
  secgen: { name: 'Secretary-General Election', desc: 'Elect a nation to lead the council. Two wins = Diplomatic Victory.' },
  aid: { name: 'Humanitarian Aid', desc: 'Yes voters donate funds to a nation in crisis.' },
};

export function proposeResolution(g: Game, proposer: number, kind: ResolutionKind, target: number): string | null {
  if (g.s.un.res.some((r) => !r.resolved)) return 'A resolution is already being voted on';
  if (proposer === g.s.player && g.s.un.res.some((r) => r.proposer === proposer && g.day - r.day < 60)) return 'You can propose one resolution every 60 days';
  const r: Resolution = { id: g.nextId(), day: g.day, kind, target, proposer, yes: [], no: [], abstain: [], veto: -1, passed: false, resolved: false, voteDay: g.day + 10 };
  g.s.un.res.push(r);
  const what = kind === 'peacekeep' ? (g.s.wars.find((w) => w.id === target)?.name ?? 'a war') : kind === 'secgen' ? g.name(target) : g.name(target);
  g.news('un', `🏛️ ${councilName(g)}: ${g.name(proposer)} tables a resolution — ${RES_INFO[kind].name}: ${what}. Vote in 10 days.`, [proposer, target]);
  if (proposer !== g.s.player) g.toast(`🏛️ New ${councilName(g)} vote: ${RES_INFO[kind].name} — ${what}`, 'info');
  return null;
}

/** Player's vote; stored until the vote closes. */
export function playerVote(g: Game, resId: number, vote: 'yes' | 'no' | 'abstain') {
  const r = g.s.un.res.find((x) => x.id === resId);
  if (!r || r.resolved) return;
  const me = g.s.player;
  r.yes = r.yes.filter((x) => x !== me);
  r.no = r.no.filter((x) => x !== me);
  r.abstain = r.abstain.filter((x) => x !== me);
  r[vote].push(me);
}

function aiVote(g: Game, r: Resolution, n: number): 'yes' | 'no' | 'abstain' {
  const rel = (x: number) => g.rel(n, x);
  switch (r.kind) {
    case 'condemn':
    case 'sanction':
    case 'disarm': {
      if (n === r.target || g.allied(n, r.target)) return 'no';
      const v = -rel(r.target) + rel(r.proposer) * 0.5;
      return v > 25 ? 'yes' : v < -15 ? 'no' : 'abstain';
    }
    case 'peacekeep': {
      const w = g.s.wars.find((x) => x.id === r.target);
      if (!w) return 'abstain';
      if (w.att.includes(n)) return 'no';
      return g.s.nations[n].pers === 'expansionist' ? 'abstain' : 'yes';
    }
    case 'secgen':
      return rel(r.target) > 20 ? 'yes' : rel(r.target) < -20 ? 'no' : 'abstain';
    case 'aid':
      return rel(r.target) > -10 ? 'yes' : 'abstain';
  }
}

export function unDay(g: Game) {
  const { s } = g;
  for (const r of s.un.res) if (!r.resolved && g.day >= r.voteDay) closeVote(g, r);
  if (g.day < s.un.next) return;
  s.un.next = g.day + 90;
  // auto-generated agenda
  if (s.un.res.some((r) => !r.resolved)) return;
  if (g.day > 0 && g.day % 720 < 90) {
    // Secretary-General election: most liked nation stands
    const cand = s.nations.filter((n) => n.alive && n.active).map((n) => ({ n: n.idx, score: s.nations.reduce((a, m) => a + (m.alive ? g.rel(m.idx, n.idx) : 0), 0) + n.gdp * 0.001 }));
    cand.sort((a, b) => b.score - a.score);
    let target = cand[0].n;
    if (cand.findIndex((c) => c.n === s.player) >= 0 && cand.findIndex((c) => c.n === s.player) < 3) target = s.player;
    proposeResolution(g, target, 'secgen', target);
    return;
  }
  // condemn / sanction aggressors, peacekeeping for long wars, disarmament of rogue nuclear states
  const recent = s.wars.filter((w) => g.day - w.start < 120);
  if (recent.length) {
    const w = recent[0];
    const aggressor = w.att[0];
    const proposer = s.nations.filter((n) => n.alive && n.idx !== aggressor && !g.allied(n.idx, aggressor)).sort((a, b) => g.rel(a.idx, aggressor) - g.rel(b.idx, aggressor))[0];
    if (proposer && proposer.idx !== s.player) {
      proposeResolution(g, proposer.idx, g.rand() < 0.5 ? 'condemn' : 'sanction', aggressor);
      return;
    }
  }
  const long = s.wars.find((w) => g.day - w.start > 365);
  if (long) {
    const prop = s.nations.find((n) => n.alive && n.idx !== s.player && !long.att.includes(n.idx) && !long.def.includes(n.idx) && n.pers === 'defensive');
    if (prop) { proposeResolution(g, prop.idx, 'peacekeep', long.id); return; }
  }
  const armed = s.nations.find((n) => n.alive && n.nukesArmed && n.idx !== s.player);
  if (armed) {
    const prop = s.nations.find((n) => n.alive && n.idx !== s.player && g.rel(n.idx, armed.idx) < -20);
    if (prop) proposeResolution(g, prop.idx, 'disarm', armed.idx);
  }
}

function closeVote(g: Game, r: Resolution) {
  const { s } = g;
  r.resolved = true;
  const voted = new Set([...r.yes, ...r.no, ...r.abstain]);
  for (const n of s.nations) {
    if (!n.alive || !n.active || voted.has(n.idx)) continue;
    if (n.idx === s.player) { r.abstain.push(n.idx); continue; }
    r[aiVote(g, r, n.idx)].push(n.idx);
  }
  if (r.kind !== 'secgen' && r.kind !== 'aid') {
    for (const p of s.un.permanent) if (r.no.includes(p) && s.nations[p].alive) { r.veto = p; break; }
  }
  r.passed = r.veto < 0 && r.yes.length > r.no.length;
  const title = `${RES_INFO[r.kind].name}${r.kind === 'peacekeep' ? '' : ': ' + g.name(r.target)}`;
  if (r.veto >= 0) g.news('un', `🏛️ ${g.name(r.veto)} vetoes the resolution (${title}).`, [r.veto]);
  else g.news('un', `🏛️ Resolution ${r.passed ? 'PASSED' : 'FAILED'} (${r.yes.length}-${r.no.length}): ${title}.`, [r.target]);
  if (!r.passed) return;
  switch (r.kind) {
    case 'condemn':
      for (const y of r.yes) g.addRel(y, r.target, -10);
      s.nations[r.target].stability = Math.max(0, s.nations[r.target].stability - 5);
      break;
    case 'sanction':
      for (const y of r.yes) if (y !== r.target && !g.allied(y, r.target)) setSanction(g, y, r.target, true);
      break;
    case 'peacekeep': {
      const w = s.wars.find((x) => x.id === r.target);
      if (!w) break;
      for (const n of [...w.att, ...w.def]) s.nations[n].warWeariness = Math.min(100, s.nations[n].warWeariness + 15);
      const a = w.att[0], d = w.def[0];
      if (a !== s.player && d !== s.player && Math.abs(w.score) < 40) whitePeace(g, a, d);
      break;
    }
    case 'disarm': {
      const T = s.nations[r.target];
      if (r.target !== s.player && (T.gov === 'democracy' || T.pers !== 'expansionist')) {
        T.nukes = Math.floor(T.nukes * 0.67);
        T.nukesArmed = false;
      } else for (const y of r.yes) setSanction(g, y, r.target, true);
      break;
    }
    case 'secgen':
      s.un.secGen = r.target;
      s.un.secGenWins[r.target] = (s.un.secGenWins[r.target] || 0) + 1;
      g.notify([r.target], `🏛️ We were elected Secretary-General of the ${councilName(g)}!`, 'good');
      break;
    case 'aid':
      for (const y of r.yes) {
        const amt = Math.min(s.nations[y].treasury * 0.01, 2);
        s.nations[y].treasury -= amt;
        s.nations[r.target].treasury += amt;
      }
      break;
  }
}
