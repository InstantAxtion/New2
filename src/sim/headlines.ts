// Light-hearted headline templates, so the news reads like a tabloid rather than a report.
import type { Game } from './ctx';

type Fill = Record<string, string>;
const T: Record<string, string[]> = {
  war: [
    '⚔️ {A} declares war on {B}!',
    '⚔️ It\'s on! {A} goes to war with {B}.',
    '⚔️ {A} has had enough of {B}: war declared!',
    '⚔️ Diplomats flee as {A} attacks {B}.',
  ],
  capital: [
    '🏙️ {A} storms {C}, the capital of {B}!',
    '🏙️ {C} falls! {A} troops parade through {B}\'s capital.',
    '🏙️ Shock in {B}: the capital {C} is in {A}\'s hands.',
  ],
  surrender: [
    '🏳️ {B} waves the white flag!',
    '🏳️ {B} gives up. Generals blame the weather.',
    '🏳️ It\'s over for {B}: surrender announced.',
  ],
  gone: [
    '🏴 {B} has been wiped off the map.',
    '🏴 Mapmakers erase {B}. Cartographers weep.',
  ],
  peace: [
    '🕊️ Peace! The {W} is over.',
    '🕊️ Handshakes all round: the {W} ends.',
    '🕊️ Soldiers head home as the {W} comes to an end.',
  ],
  alliance: [
    '🤝 {A} and {B} are now best friends (militarily).',
    '🤝 New alliance: {A} and {B} promise to have each other\'s backs.',
    '🤝 {A} and {B} sign an alliance over a very long dinner.',
  ],
  joins: [
    '📣 {A} jumps into the {W}!',
    '📣 {A} joins the {W}. Things just got bigger.',
  ],
  betray: [
    '💔 {A} ditches {B}: "It\'s not you, it\'s the war."',
    '💔 {A} refuses to fight for {B} and quits the alliance.',
  ],
  aid: [
    '💸 {A} sends {M} in aid to {B}. "Go get \'em!"',
    '💸 Care package! {A} wires {M} to help {B} fight on.',
    '💸 {B} gets {M} in emergency aid from {A}.',
  ],
  embargo: [
    '🚫 {A} stops buying from {B}. Awkward.',
    '🚫 Trade spat: {A} slaps an embargo on {B}.',
  ],
};

export function headline(g: Game, kind: keyof typeof T, fill: Fill): string {
  let t = g.pick(T[kind]);
  for (const [k, v] of Object.entries(fill)) t = t.split('{' + k + '}').join(v);
  return t;
}
