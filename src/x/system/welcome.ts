import type { Ctx } from '../core';
import type { SystemPrefs } from './prefs';

// A short welcome the first time, a list of tips, and what's new after an update.

export const OVERHAUL_VERSION = '2.0';

/** What changed in this version, by theme. (Other feature groups add theirs here.) */
export const WHATS_NEW: { title: string; items: string[] }[] = [
  {
    title: '🌦️ Weather, sky & time',
    items: [
      'Changing weather: sun, cloud, rain, storms, fog and snow drift past as you drive, with a forecast',
      'The time of day can follow your phone\'s clock, and a day can last from 8 minutes to 2 hours',
      'The moon shows tonight\'s real phase; comets and satellites cross the night sky',
      'Gusts of wind nudge the car in storms and sandstorms',
    ],
  },
  {
    title: '🔊 Sound',
    items: [
      'Separate levels for rain, wind, tyres, traffic and wildlife, and a quiet-cabin switch',
      'Sleep sounds: your own mix of rain, wind, waves, crickets and birdsong for long auto-drives',
    ],
  },
  {
    title: '📱 Your phone',
    items: [
      'Battery saver: hold the picture to 45 or 30 frames a second, or let it decide when the battery is low',
      'The picture can dim itself on long auto-drives, and the screen stays on while you drive',
      'Backup & restore: move your cars, passport and journeys to another phone',
      'Bigger text if you want it',
    ],
  },
];

const TIPS: string[] = [
  'Tap ✨ More for everything that isn\'t on the main screen.',
  'Hold BRAKE once you\'ve stopped to reverse.',
  'On auto-drive the car overtakes slower traffic by itself when the road ahead is straight and clear.',
  'Drag anywhere to look around; double-tap to look straight ahead again.',
  '👁️ Hide all (in the ☰ menu) clears the screen: tap to bring the controls back.',
  'Set a 🌙 sleep timer in the pause menu: the car pulls over and the music fades out.',
  'Turn on 🌦️ Changing weather in ⚙️ Settings → Weather & time, and watch the sky for what\'s coming.',
  'A long drive at night? Settings → Your phone can dim the picture after a few minutes.',
  'Running low on battery? Settings → Screen refresh → 30 uses much less power.',
  'Make a backup now and then (Settings → Backup & restore) so your passport is never lost.',
];

/** Add tips from other features (shown in 💡 Tips). */
export function addTips(list: string[]) {
  for (const t of list) if (!TIPS.includes(t)) TIPS.push(t);
}

const CARDS: { icon: string; title: string; text: string }[] = [
  { icon: '🕹️', title: 'Just drive', text: 'Pick a car and press Drive. ◀ ▶ steer, GAS and BRAKE do the rest. There are no goals and nothing to lose.' },
  { icon: '🤖', title: 'Or sit back', text: 'Auto-drive keeps its lane, slows for bends and towns and overtakes by itself. Watch the world go by.' },
  { icon: '✨', title: 'More to find', text: 'The ✨ More button holds the extras: weather, sleep sounds, tips and more. Settings has the rest.' },
  { icon: '🎵', title: 'Bring your music', text: 'Tap 🎵 for YouTube, radio, podcasts or a Spotify playlist. The engine quietens down while it plays.' },
];

export function mountWelcome(ctx: Ctx) {
  const { game } = ctx;
  const p = game.settings.x.system as SystemPrefs;

  // Tips
  const tips = ctx.sheet('xtips', '💡 Tips');
  ctx.tile({ id: 'tips', icon: '💡', label: 'Tips', order: 90, run: () => {
    tips.innerHTML = `<ul class="xs-list">${TIPS.map((t) => `<li>${t}</li>`).join('')}</ul><button class="ghost small" id="xs-again">Show the welcome again</button>`;
    (tips.querySelector('#xs-again') as HTMLElement).onclick = () => { ctx.close('xtips'); showWelcome(); };
    ctx.open('xtips');
  } });

  // What's new
  const news = ctx.sheet('xnew', `🆕 What's new in ${OVERHAUL_VERSION}`);
  const renderNews = () => {
    news.innerHTML = WHATS_NEW.map((g) => `<section class="sgroup xs-news"><h3>${g.title}</h3><ul class="xs-list">${g.items.map((t) => `<li>${t}</li>`).join('')}</ul></section>`).join('');
  };
  ctx.tile({ id: 'whatsnew', icon: '🆕', label: 'What\'s new', order: 95, run: () => { renderNews(); ctx.open('xnew'); } });

  // The welcome: four cards, once
  const el = document.createElement('div');
  el.id = 'xs-welcome';
  document.body.appendChild(el);
  let at = 0;
  const done = () => {
    el.classList.remove('on');
    p.welcomed = true;
    p.seenVersion = OVERHAUL_VERSION;
    ctx.save();
  };
  const render = () => {
    const c = CARDS[at];
    const last = at === CARDS.length - 1;
    el.innerHTML = `<div class="xs-wcard card"><i>${c.icon}</i><h2>${c.title}</h2><p>${c.text}</p>
      <div class="xs-dots">${CARDS.map((_, i) => `<span class="${i === at ? 'on' : ''}"></span>`).join('')}</div>
      <div class="xs-wbtns"><button class="ghost small" id="xs-skip"${last ? ' style="visibility:hidden"' : ''}>Skip</button><button class="go small" id="xs-next">${last ? 'Let\'s go' : 'Next'}</button></div></div>`;
    (el.querySelector('#xs-skip') as HTMLElement).onclick = done;
    (el.querySelector('#xs-next') as HTMLElement).onclick = () => {
      if (last) return done();
      at++;
      render();
    };
  };
  function showWelcome() {
    at = 0;
    render();
    el.classList.add('on');
  }

  if (!p.welcomed) {
    // Someone who has driven before doesn't need the basics: they get what's new instead
    const veteran = game.stats.data.totalM > 2000;
    if (veteran) {
      p.welcomed = true;
      ctx.save();
    } else showWelcome();
  }
  if (p.welcomed && p.seenVersion !== OVERHAUL_VERSION) {
    p.seenVersion = OVERHAUL_VERSION;
    ctx.save();
    // (after the other feature groups have added their lists)
    setTimeout(() => { renderNews(); ctx.open('xnew'); }, 600);
  }
  return { showWelcome };
}
