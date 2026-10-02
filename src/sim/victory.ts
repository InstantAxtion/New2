// Victory & defeat conditions, scores.
import { SCENARIO_BY_ID } from '../data/scenarios';
import type { Game } from './ctx';
import { militaryPower } from './diplomacy';

/** Share of the world (half land area, half population) a nation controls. */
export function worldShare(g: Game, n: number, filter?: (owner: number) => boolean) {
  let land = 0, pop = 0, tLand = 0, tPop = 0;
  g.s.provinces.forEach((p, i) => {
    if (filter && !filter(p.owner)) return;
    const a = g.w.provs[i].area;
    tLand += a;
    tPop += p.pop;
    if (p.ctrl === n) { land += a; pop += p.pop; }
  });
  return tLand > 0 ? 0.5 * (land / tLand) + 0.5 * (pop / Math.max(1, tPop)) : 0;
}

export function scores(g: Game): { n: number; score: number }[] {
  const { s } = g;
  const alive = s.nations.filter((n) => n.alive && n.active);
  const totInc = alive.reduce((a, n) => a + n.income, 0) || 1;
  const mil = alive.map((n) => militaryPower(g, n.idx));
  const totMil = mil.reduce((a, b) => a + b, 0) || 1;
  const region = s.settings.region ? (o: number) => s.nations[o].active : undefined;
  return alive.map((n, k) => ({
    n: n.idx,
    score: Math.round(500 * worldShare(g, n.idx, region) + 300 * (n.income / totInc) + 200 * (mil[k] / totMil)),
  })).sort((a, b) => b.score - a.score);
}

export function incomeRank(g: Game, n: number) {
  const list = g.s.nations.filter((x) => x.alive).sort((a, b) => b.income - a.income);
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
  const where = s.settings.region ?? 'the world';
  if (v.conquest > 0) {
    if (worldShare(g, me, region) >= v.conquest) { win(g, `Victory! You control ${Math.round(v.conquest * 100)}% of ${where}.`); return; }
    if (g.day % 30 === 0) for (const n of s.nations) if (n.alive && n.idx !== me && worldShare(g, n.idx, region) >= v.conquest) { lose(g, `${n.name} has conquered ${Math.round(v.conquest * 100)}% of ${where}.`); return; }
  }
  const goal = SCENARIO_BY_ID[s.scenario]?.goal;
  const years = g.day / 365.25;
  if (goal) {
    switch (goal.kind) {
      case 'continent': {
        const share = continentShare(g, me, goal.cont);
        if (share >= goal.share) { win(g, `Challenge complete: you control ${Math.round(share * 100)}% of ${goal.cont}!`); return; }
        break;
      }
      case 'survive':
        if (years >= goal.years && P.capital >= 0 && s.provinces[P.capital].ctrl === me) { win(g, `Challenge complete: ${P.name} survived ${goal.years} years!`); return; }
        break;
      case 'gdp_rank': {
        const rank = incomeRank(g, me);
        if (rank <= goal.rank) { win(g, `Challenge complete: ${P.name} now has the world's #${rank} income!`); return; }
        if (years >= goal.years) { lose(g, `Time is up: ${P.name} only reached #${rank} by income.`); return; }
        break;
      }
      case 'restore': {
        const ids = new Set(goal.nations);
        let ok = true;
        s.provinces.forEach((p, i) => { if (ids.has(g.w.nations[g.w.provs[i].baseOwner].id) && p.owner !== me) ok = false; });
        if (ok) { win(g, 'Challenge complete: the Union has been restored!'); return; }
        break;
      }
      case 'region_score':
        if (years >= goal.years) {
          const sc = scores(g);
          if (sc[0].n === me) win(g, `Quick match won: ${P.name} finished with the highest score (${sc[0].score}).`);
          else lose(g, `Quick match over: ${g.name(sc[0].n)} won with ${sc[0].score} points (you: ${sc.find((x) => x.n === me)?.score ?? 0}).`);
          return;
        }
        break;
    }
  }
  if (g.year >= v.endYear) {
    const sc = scores(g);
    const rank = sc.findIndex((x) => x.n === me) + 1;
    if (rank <= 3) win(g, `The era ends in ${v.endYear}. ${P.name} finishes #${rank} among the world powers.`);
    else lose(g, `The era ends in ${v.endYear}. ${P.name} finishes #${rank} among the world powers.`);
  }
}

export function continentShare(g: Game, n: number, cont: string) {
  let tot = 0, mine = 0;
  g.s.provinces.forEach((p, i) => {
    if (g.w.nations[g.w.provs[i].baseOwner].cont !== cont) return;
    const a = g.w.provs[i].area;
    tot += a;
    if (p.ctrl === n || p.owner === n) mine += a;
  });
  return tot > 0 ? mine / tot : 0;
}
