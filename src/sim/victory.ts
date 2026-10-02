// Victory & defeat conditions, scores.
import { SCENARIO_BY_ID } from '../data/scenarios';
import type { Game } from './ctx';
import { militaryPower } from './diplomacy';

export function worldShare(g: Game, n: number, filter?: (owner: number) => boolean) {
  let land = 0, pop = 0, tLand = 0, tPop = 0;
  g.s.provinces.forEach((p, i) => {
    if (filter && !filter(p.owner)) return;
    const a = g.w.provs[i].area;
    tLand += a;
    tPop += p.pop;
    if (p.ctrl === n || g.s.vassal[p.ctrl] === n) { land += a; pop += p.pop; }
  });
  return tLand > 0 ? 0.5 * (land / tLand) + 0.5 * (pop / Math.max(1, tPop)) : 0;
}

export function scores(g: Game): { n: number; score: number }[] {
  const { s } = g;
  const alive = s.nations.filter((n) => n.alive && n.active);
  const totGdp = alive.reduce((a, n) => a + n.gdp, 0) || 1;
  const mil = alive.map((n) => militaryPower(g, n.idx));
  const totMil = mil.reduce((a, b) => a + b, 0) || 1;
  const region = s.settings.region ? (o: number) => s.nations[o].active : undefined;
  return alive.map((n, k) => ({
    n: n.idx,
    score: Math.round(400 * worldShare(g, n.idx, region) + 300 * (n.gdp / totGdp) + 200 * (mil[k] / totMil) + 100 * (n.techs.length / 60)),
  })).sort((a, b) => b.score - a.score);
}

export function gdpRank(g: Game, n: number) {
  const list = g.s.nations.filter((x) => x.alive).sort((a, b) => b.gdp - a.gdp);
  return list.findIndex((x) => x.idx === n) + 1;
}

function win(g: Game, reason: string) {
  if (!g.s.over) g.s.over = { won: true, reason, day: g.day };
}
function lose(g: Game, reason: string) {
  if (!g.s.over) g.s.over = { won: false, reason, day: g.day };
}

/** Daily check. */
export function checkVictory(g: Game) {
  const { s } = g;
  if (s.over) return;
  const me = s.player;
  const P = s.nations[me];
  const v = s.settings.victory;
  if (!P.alive) { lose(g, `${P.name} no longer exists.`); return; }
  const region = s.settings.region ? (o: number) => s.nations[o].active : undefined;

  // conquest (and AI world conquest = defeat)
  if (v.conquest > 0) {
    if (worldShare(g, me, region) >= v.conquest) { win(g, `Military victory: you control ${Math.round(v.conquest * 100)}% of ${s.settings.region ?? 'the world'}.`); return; }
    if (g.day % 30 === 0) for (const n of s.nations) if (n.alive && n.idx !== me && worldShare(g, n.idx, region) >= v.conquest) { lose(g, `${n.name} has conquered ${Math.round(v.conquest * 100)}% of ${s.settings.region ?? 'the world'}.`); return; }
  }
  // economic: checked each new year
  const date = g.date();
  if (v.economic > 0 && date.getUTCMonth() === 0 && date.getUTCDate() === 1 && g.day > 0) {
    for (const n of s.nations) {
      if (!n.alive) continue;
      n.topGdpYears = gdpRank(g, n.idx) === 1 ? n.topGdpYears + 1 : 0;
    }
    if (P.topGdpYears >= v.economic) { win(g, `Economic victory: the world's largest economy for ${v.economic} years.`); return; }
  }
  // diplomatic
  if (v.diplomatic) {
    if ((s.un.secGenWins[me] || 0) >= 2) { win(g, 'Diplomatic victory: twice elected Secretary-General of the world council.'); return; }
    const bloc = g.blocOf(me);
    if (bloc && bloc.leader === me && bloc.members.length >= 5) {
      const tot = s.nations.reduce((a, n) => a + (n.alive ? n.gdp : 0), 0);
      const share = bloc.members.reduce((a, m) => a + s.nations[m].gdp, 0) / Math.max(1, tot);
      if (share >= 0.6) { win(g, `Diplomatic victory: your ${bloc.name} commands ${Math.round(share * 100)}% of the world economy.`); return; }
    }
  }
  // technology
  if (v.tech && P.techs.includes('mars_program')) { win(g, 'Technology victory: your Mars colonization program succeeded!'); return; }

  // challenges
  const sc = SCENARIO_BY_ID[s.scenario];
  const goal = sc?.goal;
  const years = g.day / 365.25;
  if (goal) {
    switch (goal.kind) {
      case 'continent': {
        const contShare = continentShare(g, me, goal.cont);
        if (contShare >= goal.share) { win(g, `Challenge complete: you control ${Math.round(contShare * 100)}% of ${goal.cont}!`); return; }
        break;
      }
      case 'survive': {
        const cap = P.capital >= 0 && s.provinces[P.capital].ctrl === me;
        if (years >= goal.years && cap) { win(g, `Challenge complete: ${P.name} survived ${goal.years} years!`); return; }
        break;
      }
      case 'gdp_rank': {
        const rank = gdpRank(g, me);
        if (rank <= goal.rank) { win(g, `Challenge complete: ${P.name} is now the world's #${rank} economy!`); return; }
        if (years >= goal.years) { lose(g, `Time is up: ${P.name} only reached #${rank} by GDP.`); return; }
        break;
      }
      case 'restore': {
        const ids = new Set(goal.nations);
        let ok = true;
        s.provinces.forEach((p, i) => {
          if (!ids.has(g.w.nations[g.w.provs[i].baseOwner].id)) return;
          if (p.owner !== me && s.vassal[p.owner] !== me) ok = false;
        });
        if (ok) { win(g, 'Challenge complete: the Union has been restored!'); return; }
        break;
      }
      case 'region_score':
        if (years >= goal.years) {
          const sc2 = scores(g);
          if (sc2[0].n === me) win(g, `Quick match won: ${P.name} finished with the highest score (${sc2[0].score}).`);
          else lose(g, `Quick match over: ${g.name(sc2[0].n)} won with ${sc2[0].score} points (you: ${sc2.find((x) => x.n === me)?.score ?? 0}).`);
          return;
        }
        break;
    }
  }
  // end year
  if (g.year >= v.endYear) {
    if (v.survival) { win(g, `Survival victory: ${P.name} endured until ${v.endYear}.`); return; }
    const sc2 = scores(g);
    const rank = sc2.findIndex((x) => x.n === me) + 1;
    if (rank <= 3) win(g, `The era ends in ${v.endYear}. ${P.name} finishes #${rank} among the world powers.`);
    else lose(g, `The era ends in ${v.endYear}. ${P.name} finishes #${rank} among the world powers.`);
  }
}

export function continentShare(g: Game, n: number, cont: string) {
  let tot = 0, mine = 0;
  g.s.provinces.forEach((p, i) => {
    const base = g.w.nations[g.w.provs[i].baseOwner];
    if (base.cont !== cont) return;
    const a = g.w.provs[i].area;
    tot += a;
    if (p.ctrl === n || g.s.vassal[p.ctrl] === n || p.owner === n) mine += a;
  });
  return tot > 0 ? mine / tot : 0;
}
