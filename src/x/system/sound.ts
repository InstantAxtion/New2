import type { Ctx } from '../core';
import type { SystemPrefs } from './prefs';

// Finer sound levels, a quiet cabin, and a mix of sounds to fall asleep to.

export function mountSound(ctx: Ctx, group: HTMLElement) {
  const { game } = ctx;
  const p = game.settings.x.system as SystemPrefs;
  const eng = game.engine;
  const apply = () => {
    eng.levels.roof = p.lvRoof;
    eng.levels.wind = p.lvWind;
    eng.levels.tyres = p.lvTyres;
    eng.levels.traffic = p.lvTraffic;
    eng.levels.wildlife = p.lvWildlife;
    eng.quietCabin = p.quietCabin;
    const own = p.sleepMix === 'own';
    eng.mixOverride = own ? { rain: p.slRain, wind: p.slWind, waves: p.slWaves, crickets: p.slCrickets, birds: p.slBirds } : null;
    eng.engineScale = own ? p.slHum * 2 : 1;
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const box = document.createElement('details');
  box.className = 'sgroup advanced';
  box.innerHTML = '<summary>More sound</summary>';
  group.parentElement!.insertBefore(box, group.nextSibling);
  ctx.range(box, '🌧️ Rain', 'system', 'lvRoof', 0, 1.5, 0.05, apply, pct);
  ctx.range(box, '💨 Wind', 'system', 'lvWind', 0, 1.5, 0.05, apply, pct);
  ctx.range(box, '🛞 Tyres & road', 'system', 'lvTyres', 0, 1.5, 0.05, apply, pct);
  ctx.range(box, '🚙 Traffic', 'system', 'lvTraffic', 0, 1.5, 0.05, apply, pct);
  ctx.range(box, '🐦 Wildlife', 'system', 'lvWildlife', 0, 1.5, 0.05, apply, pct);
  ctx.seg(box, 'Quiet cabin', 'system', 'quietCabin', [[false, 'Off'], [true, 'On']], apply);

  // Sleep sounds
  const sheet = ctx.sheet('xsleep', '🛏️ Sleep sounds');
  const intro = document.createElement('p');
  intro.className = 'hint';
  intro.textContent = 'Sounds to drift off to on a long auto-drive. Match the place you\'re driving through, or set your own mix that stays the same wherever the road goes.';
  sheet.appendChild(intro);
  const own = document.createElement('div');
  ctx.seg(sheet, 'Sounds', 'system', 'sleepMix', [['place', 'This place'], ['own', 'My mix']], () => {
    apply();
    own.classList.toggle('xs-off', p.sleepMix !== 'own');
    game.engine.start();
  });
  own.className = 'sgroup' + (p.sleepMix === 'own' ? '' : ' xs-off');
  sheet.appendChild(own);
  ctx.range(own, '🌧️ Rain', 'system', 'slRain', 0, 1, 0.05, apply, pct);
  ctx.range(own, '💨 Wind', 'system', 'slWind', 0, 1, 0.05, apply, pct);
  ctx.range(own, '🌊 Waves', 'system', 'slWaves', 0, 1, 0.05, apply, pct);
  ctx.range(own, '🦗 Crickets', 'system', 'slCrickets', 0, 1, 0.05, apply, pct);
  ctx.range(own, '🐦 Birdsong', 'system', 'slBirds', 0, 1, 0.05, apply, pct);
  ctx.range(own, '🚗 Engine hum', 'system', 'slHum', 0, 1, 0.05, apply, pct);
  const tip = document.createElement('p');
  tip.className = 'hint';
  tip.innerHTML = 'Pair it with the 🌙 sleep timer (pause menu): the car pulls over and everything fades out.';
  sheet.appendChild(tip);
  ctx.tile({ id: 'sleepsounds', icon: '🛏️', label: 'Sleep sounds', sub: 'Rain, waves, crickets', order: 45, run: () => ctx.open('xsleep') });
  apply();
  return { apply };
}
