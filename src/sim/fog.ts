// Fog of war: what the player can see.
//
// You see your own and your allies' land, the regions next to it, and the area
// around your troops, ships and planes. Elsewhere you only see the map colours
// (who owns what) — no troops and no buildings.
import { UNITS } from '../data/units';
import type { Game } from './ctx';
import type { Loc } from './types';

export function updateVisibility(g: Game) {
  const { s, w } = g;
  const vis = g.rt.visible;
  const sea = g.rt.seaVisible;
  if (!s.settings.fog) { vis.fill(1); sea.fill(1); return; }
  vis.fill(0);
  sea.fill(0);
  const me = s.player;
  const see = (p: number) => {
    vis[p] = 1;
    for (const c of w.provs[p].sea) sea[c] = 1;
  };
  for (let i = 0; i < s.provinces.length; i++) {
    const c = s.provinces[i].ctrl;
    if (c !== me && !g.allied(c, me)) continue;
    see(i);
    for (const q of w.provs[i].nb) see(q);
  }
  for (const u of s.units) {
    if (u.owner !== me && !g.allied(u.owner, me)) continue;
    const d = UNITS[u.type].domain;
    if (u.loc >= 0) {
      see(u.loc);
      for (const q of w.provs[u.loc].nb) see(q);
      if (u.path.length && u.path[0] >= 0) see(u.path[0]);
    } else {
      const c = -u.loc - 1;
      sea[c] = 1;
      for (const nb of w.cells[c].nb) {
        sea[nb] = 1;
        if (d === 'sea') for (const nb2 of w.cells[nb].nb) sea[nb2] = 1;
      }
      for (const p of w.cells[c].coast) vis[p] = 1;
    }
    if (d === 'air' && u.target >= 0) {
      see(u.target);
      for (const q of w.provs[u.target].nb) vis[q] = 1;
    }
  }
}

export function locVisible(g: Game, l: Loc) {
  return l >= 0 ? g.rt.visible[l] === 1 : g.rt.seaVisible[-l - 1] === 1;
}

/** Can the player see this unit? */
export function unitVisible(g: Game, owner: number, l: Loc) {
  const me = g.s.player;
  if (owner === me || g.allied(owner, me)) return true;
  return locVisible(g, l);
}
