import type { Game } from '../game';
import type { UI } from '../ui';
import { makeCtx, mountHub } from './core';
import { mountLook } from './look';
import { mountScenery } from './scenery';
import { mountJourney } from './journey';
import { mountCarx } from './carx';
import { mountSystem } from './system';
import './x.css';

/** Plug every add-on feature group into the game. */
export function mountExtras(game: Game, ui: UI) {
  const ctx = makeCtx(game, ui);
  game.bus = ctx;
  for (const [name, mount] of [['look', mountLook], ['scenery', mountScenery], ['journey', mountJourney], ['carx', mountCarx], ['system', mountSystem]] as const) {
    try {
      mount(ctx);
    } catch (e) {
      console.warn('Feature group failed to start:', name, e);
    }
  }
  mountHub(ctx);
  return ctx;
}
