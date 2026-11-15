import type { Game } from '../game';
import type { UI } from '../ui';
import { makeCtx, mountHub } from './core';
import { mountLook } from './look';
import { mountScenery } from './scenery';
import { mountJourney } from './journey';
import { mountCarx } from './carx';
import { mountSystem } from './system';
import { addTips, WHATS_NEW } from './system';
import { CARX_HINTS } from './carx';
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
  addTips(CARX_HINTS);
  addTips([
    '📷 ✨ More → Photo mode stops the world so you can frame a picture; your photos are kept in the Album.',
    '🎬 On auto-drive, try ✨ More → Cinematic camera and just watch.',
    '🧭 ✨ More → Journeys has road trips, a road of the day, moods and your milestones.',
  ]);
  WHATS_NEW.unshift(
    { title: '🗺️ Four new regions', items: [
      '🌋 Volcanic Island: black sand, lava fields that glow at night, steaming vents and a smoking volcano',
      '🏖️ Mediterranean Coast: white villages, olive groves, turquoise coves and a blue-domed chapel',
      '🏴 Highland Moors: heather, lochs, dry-stone walls, highland cattle and drifting mist',
      '🐊 Bayou Wetlands: a causeway through cypress swamp, timber trestles, herons and fireflies',
    ] },
    { title: '📷 Camera & picture', items: [
      'Photo mode: stop the world, move the camera, change the time of day, and save the picture to your Album',
      'Eight picture styles, from Vivid to Black & white, plus film grain and blur at speed',
      'Cinematic camera and drone view for auto-drive',
      'Sliders for the camera\'s distance, height and field of view',
    ] },
    { title: '🧭 Journeys', items: [
      'Road trips to real places up the road, with a quiet progress line',
      'A road of the day, three gentle ideas each day, and 60 milestones',
      'One-tap moods such as Rainy night city or Golden hour coast',
      'A trip computer, a trip summary to share, and a journal of everything you\'ve seen',
    ] },
    { title: '🚗 Car & controls', items: [
      'Horn, indicators, hazard lights and reversing lamps',
      'Eco, Comfort and Sport drive modes',
      'Tyre marks, exhaust vapour on cold mornings and tyre smoke',
      'Underglow, window glass, headlight colour, tyre styles, a roof box, kayak, teardrop camper and jet-ski',
      'A steering-wheel control, left-handed layout, bigger buttons, game controllers and vibration',
      'Dial or bar speed displays, and Rest here to pull over and take in the view',
    ] },
    { title: '🌄 Along the road', items: [
      'Wind farms, power lines, hay bales, tractors and scarecrows',
      'Funny billboards and giant roadside attractions',
      'Roadworks, tumbleweeds, pump jacks and dust devils',
      'Beach umbrellas, kites and surfers; cable cars, ski lifts and snowmen',
      'Sky lanterns, far-off village lights, cyclists, hikers and anglers',
    ] },
  );
  mountHub(ctx);
  return ctx;
}
