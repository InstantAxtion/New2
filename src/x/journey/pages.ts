import type { Ctx } from '../core';
import { refreshControls } from '../core';
import { BIOMES, BIOME_IDS, type BiomeId } from '../../world/biomes';
import { CARS } from '../../carspecs';
import { STAMPS } from '../../stats';
import { STOP_INFO } from '../../world/world';
import type { Tracker } from './tracker';
import { MILESTONES, MILE, clock, dayKey, progress, rankFor, smoothWord, type Goal } from './logic';
import { destinations } from './trips';
import { MOODS, type Mood } from './moods';
import { drawCard, shareCanvas } from './share';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TABS: [string, string, string][] = [
  ['trips', '🧭', 'Trips'], ['today', '📅', 'Today'], ['milestones', '🏅', 'Milestones'],
  ['computer', '📈', 'Computer'], ['journal', '📔', 'Journal'], ['moods', '🎭', 'Moods'],
];
const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const bar = (k: number) => `<i class="jr-bar"><b style="width:${(Math.min(1, Math.max(0, k)) * 100).toFixed(1)}%"></b></i>`;

/** How much of a goal is done, in words ("3.2 of 5 mi", "1 of 3"). */
function amount(g: Goal, tallies: Record<string, number>, ctx: Ctx): string {
  const v = tallies[g.metric] ?? 0;
  if (g.goal === 0) return v ? `${v} to go` : 'Done';
  if (g.metric === 's') return `${clock(Math.min(v, g.goal))} of ${clock(g.goal)}`;
  if (/M$|^m$/.test(g.metric)) return `${ctx.dist(Math.min(v, g.goal))} of ${ctx.dist(g.goal, g.goal >= MILE * 10 ? 0 : 1)}`;
  return `${Math.min(Math.floor(v), g.goal)} of ${g.goal}`;
}

/** The Journeys screen and the bits of it that show up elsewhere (garage tiles, the summary card). */
export class Pages {
  private body: HTMLElement;
  private tab: string;
  private summary: HTMLElement;

  constructor(private ctx: Ctx, private tr: Tracker) {
    this.body = ctx.sheet('journeys', '🧭 Journeys');
    this.body.classList.add('jr-body');
    this.tab = TABS.some((t) => t[0] === tr.prefs.tab) ? tr.prefs.tab : 'trips';
    // The trip computer ticks while it's open
    setInterval(() => {
      if (this.tab === 'computer' && this.isOpen()) this.fill();
    }, 1000);

    // After a drive: a card over the garage
    this.summary = document.createElement('div');
    this.summary.className = 'jr-modal';
    document.getElementById('ui')!.appendChild(this.summary);

    // Ways in from the garage: two tiles on the Road page, and your rank by the title
    const row = document.querySelector('#garage .gpage[data-page="road"] .tile-row');
    if (row) {
      row.classList.add('jr-four');
      for (const [id, icon, label] of [['journeys', '🧭', 'Journeys'], ['moods', '🎭', 'Moods']]) {
        const b = document.createElement('button');
        b.className = 'tile';
        b.innerHTML = `<i>${icon}</i><span>${label}</span>`;
        b.onclick = () => this.open(id === 'moods' ? 'moods' : undefined);
        row.appendChild(b);
      }
    }
    const h1 = document.querySelector('#garage .title h1');
    if (h1) {
      const r = document.createElement('button');
      r.className = 'jr-rank';
      r.id = 'jr-rank';
      r.onclick = () => this.open('milestones');
      h1.insertAdjacentElement('afterend', r);
    }
    this.refreshRank();
  }

  private isOpen() {
    return !document.getElementById('journeys')!.classList.contains('hidden');
  }

  open(tab?: string) {
    if (tab) this.tab = tab;
    this.render();
    this.ctx.open('journeys');
  }

  /** Something changed while driving: redraw if it's on show. */
  changed() {
    if (this.isOpen()) this.fill();
    this.refreshRank();
  }

  refreshRank() {
    const el = document.getElementById('jr-rank');
    if (!el) return;
    const r = rankFor(this.ctx.game.stats.data.totalM);
    el.textContent = `${r.rank.icon} ${r.rank.name}`;
  }

  private render() {
    this.body.innerHTML = `<div class="jr-tabs hscroll">${TABS.map(([id, icon, label]) => `<button class="chip${id === this.tab ? ' on' : ''}" data-jtab="${id}">${icon} ${label}</button>`).join('')}</div><div class="jr-page"></div>`;
    for (const b of this.body.querySelectorAll<HTMLElement>('[data-jtab]')) {
      b.onclick = () => {
        this.tab = b.dataset.jtab!;
        this.tr.prefs.tab = this.tab;
        this.ctx.save();
        this.render();
      };
    }
    this.body.querySelector('.chip.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    this.fill();
  }

  private fill() {
    const page = this.body.querySelector('.jr-page') as HTMLElement | null;
    if (!page) return;
    const top = this.body.scrollTop;
    if (this.tab === 'trips') this.trips(page);
    else if (this.tab === 'today') this.today(page);
    else if (this.tab === 'milestones') this.milestones(page);
    else if (this.tab === 'computer') this.computer(page);
    else if (this.tab === 'journal') this.journal(page);
    else this.moods(page);
    this.body.scrollTop = top;
  }

  // ---- Trips ----

  private trips(page: HTMLElement) {
    const { ctx, tr } = this;
    const g = ctx.game;
    const now = tr.tripNow();
    const dir = Math.cos(g.vehicle.heading) >= 0 ? 1 : -1;
    const list = destinations(g.world, g.vehicle.z, dir);
    let html = '';
    if (now) {
      html += `<div class="jr-card"><small>On the way to</small><b>${now.trip.icon} ${esc(now.trip.name)}</b><span>${ctx.dist(now.toGo)} to go</span>${bar(now.k)}
        <button class="ghost small" id="jr-cancel">Stop this trip</button></div>`;
    } else html += `<p class="hint">Pick somewhere up the road to head for. There's no clock: a line at the top of the screen shows how far there is to go, and you can wander off whenever you like.</p>`;
    html += `<h3>${now ? 'Somewhere else' : 'Where to?'}</h3>`;
    html += list.map((d, i) => `<button class="song jr-dest" data-dest="${i}"><i>${d.icon}</i><b>${esc(d.name)}</b><span>${ctx.dist(d.m)} · ${esc(d.note)}</span></button>`).join('');
    const done = tr.prefs.tripsDone;
    html += `<h3>Trips completed${done.length ? ` <small>${tr.prefs.life.trips ?? done.length}</small>` : ''}</h3>`;
    html += done.length
      ? done.map((t) => `<div class="jr-row"><i>${t.icon}</i><b>${esc(t.name)}</b><span>${ctx.dist(t.m)} · ${date(t.at)}</span></div>`).join('')
      : `<p class="hint">None yet. Your finished trips are kept here.</p>`;
    page.innerHTML = html;
    const cancel = page.querySelector<HTMLElement>('#jr-cancel');
    if (cancel) cancel.onclick = () => tr.cancelTrip();
    for (const b of page.querySelectorAll<HTMLElement>('[data-dest]')) {
      b.onclick = () => {
        const d = list[Number(b.dataset.dest)];
        tr.startTrip(d);
        ctx.close('journeys');
        ctx.toast(`Road trip<b>${d.icon} ${esc(d.name)}</b><small>${ctx.dist(d.m)} up the road${g.phase === 'garage' ? ' · press Drive when you\'re ready' : ''}</small>`);
      };
    }
  }

  // ---- Today ----

  private today(page: HTMLElement) {
    const { ctx, tr } = this;
    const g = ctx.game;
    const daily = tr.daily();
    const t = tr.ensureToday();
    const tallies = tr.todayTallies();
    const drove = tr.prefs.dailyDone.includes(t.day);
    const onIt = g.seed === daily.seed;
    let html = `<div class="jr-card"><small>Road of the day</small><b>📅 ${esc(daily.name)}</b>
      <span>${daily.themes.map((id) => `${BIOMES[id as BiomeId].emoji} ${BIOMES[id as BiomeId].name}`).join(' · ')}</span>
      <span class="jr-dim">${drove ? '✓ Driven today' : onIt ? "You're on it now: a mile ticks it off" : 'The same road for everyone today'}</span>
      <button class="go small" id="jr-daily">${onIt ? 'Back to the start ▶' : "Drive today's road ▶"}</button></div>`;
    // The last two weeks
    const days: string[] = [];
    const d0 = new Date();
    for (let i = 13; i >= 0; i--) days.push(dayKey(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - i)));
    html += `<div class="jr-cal">${days.map((d) => {
      const star = tr.prefs.dailyDone.includes(d), on = tr.prefs.days.includes(d);
      return `<div class="${star ? 'star' : on ? 'on' : ''}${d === t.day ? ' now' : ''}"><b>${star ? '★' : on ? '●' : '·'}</b><span>${Number(d.slice(8))}</span></div>`;
    }).join('')}</div><p class="hint">● a day you drove · ★ a day you drove the road of the day · ${tr.prefs.days.length} day${tr.prefs.days.length === 1 ? '' : 's'} on the road so far</p>`;
    html += `<h3>Today's ideas <small>only if you fancy</small></h3>`;
    html += tr.todaysIdeas().map((idea) => this.goalRow(idea, tallies, t.done.includes(idea.id))).join('');
    html += `<p class="hint">Three new ideas every day. Nothing is lost if you leave them.</p>`;
    page.innerHTML = html;
    page.querySelector<HTMLElement>('#jr-daily')!.onclick = () => {
      g.travelTo(daily.seed, daily.themes as BiomeId[], 2800, daily.hour);
      ctx.save();
      ctx.ui.refreshGarage();
      ctx.close('journeys');
      if (g.phase === 'garage') ctx.ui.start();
      else if (g.phase === 'paused') ctx.ui.resume();
      ctx.toast(`Road of the day<b>📅 ${esc(daily.name)}</b>`);
    };
  }

  private goalRow(goal: Goal, tallies: Record<string, number>, done: boolean, when?: number): string {
    const k = done ? 1 : progress(goal, tallies);
    return `<div class="jr-goal${done ? ' done' : ''}"><i>${goal.icon}</i><div><b>${esc(goal.text)}</b>
      <span>${done ? (when ? `✓ ${date(when)}` : '✓ Done') : amount(goal, tallies, this.ctx)}</span>${done ? '' : bar(k)}</div></div>`;
  }

  // ---- Milestones ----

  private milestones(page: HTMLElement) {
    const { ctx, tr } = this;
    const st = ctx.game.stats.data;
    const r = rankFor(st.totalM);
    const tallies = tr.lifeTallies();
    const got = tr.prefs.milestones;
    const done = MILESTONES.filter((m) => got[m.id]).sort((a, b) => got[b.id] - got[a.id]);
    const left = MILESTONES.filter((m) => !got[m.id]).sort((a, b) => progress(b, tallies) - progress(a, tallies));
    let html = `<div class="jr-card"><small>Road rank</small><b>${r.rank.icon} ${r.rank.name}</b>
      <span>${ctx.dist(st.totalM)} driven · ${tr.prefs.days.length} day${tr.prefs.days.length === 1 ? '' : 's'} on the road</span>
      ${r.next ? `${bar(r.k)}<span class="jr-dim">${ctx.dist(r.toGo)} to ${r.next.icon} ${r.next.name}</span>` : '<span class="jr-dim">The top of the ladder. Keep wandering.</span>'}</div>`;
    html += `<h3>On the way <small>${done.length} of ${MILESTONES.length} reached</small></h3>`;
    html += left.map((m) => this.goalRow(m, tallies, false)).join('') || '<p class="hint">Every one reached. Remarkable.</p>';
    if (done.length) html += `<h3>Reached</h3>` + done.map((m) => this.goalRow(m, tallies, true, got[m.id])).join('');
    page.innerHTML = html;
  }

  // ---- Trip computer ----

  private computer(page: HTMLElement) {
    const { ctx, tr } = this;
    const g = ctx.game;
    const d = tr.drive;
    const st = g.stats.data;
    const avg = d.s > 5 ? d.m / d.s : 0;
    const score = d.smooth.score;
    const ev = g.vehicle.spec.engine === 'ev';
    const regionTime = Object.entries(d.regionS).sort((a, b) => b[1] - a[1]);
    const most = regionTime[0]?.[1] ?? 1;
    const cell = (v: string, k: string) => `<div><b>${v}</b><span>${k}</span></div>`;
    let html = `<h3>This drive</h3><div class="stat-grid">
      ${cell(ctx.dist(d.m), 'Distance')}${cell(clock(d.s), 'On the road')}
      ${cell(ctx.speed(avg), 'Average speed')}${cell(ctx.speed(d.top), 'Top speed')}
      ${cell(ctx.dist(g.fuel * 322000, 0), `${ev ? 'Charge' : 'Fuel'} left: ${Math.round(g.fuel * 100)}%`)}
      ${cell(score === null ? '–' : String(score), `Smoothness · ${smoothWord(score)}`)}</div>
      <p class="hint">Smoothness is how gently you use the pedals and the wheel. It's only for interest.</p>`;
    if (regionTime.length) {
      html += `<h3>Time in each region</h3>` + regionTime.map(([id, s]) => {
        const b = BIOMES[id as BiomeId];
        return b ? `<div class="jr-row bar"><i>${b.emoji}</i><b>${b.name}</b><span>${clock(s)}</span>${bar(s / most)}</div>` : '';
      }).join('');
    }
    const cars = Object.entries(st.perCar).filter(([, m]) => m > 50).sort((a, b) => b[1] - a[1]);
    if (cars.length) {
      html += `<h3>Odometers <small>every mile in each car</small></h3>` + cars.map(([id, m]) => {
        const car = CARS.find((c) => c.id === id);
        return car ? `<div class="jr-row bar"><i>🚗</i><b>${esc(car.name)}</b><span>${ctx.dist(m)}</span>${bar(m / cars[0][1])}</div>` : '';
      }).join('');
    }
    html += `<h3>All time</h3><div class="stat-grid">${cell(ctx.dist(st.totalM), 'Driven')}${cell(clock(st.totalS), 'On the road')}
      ${cell(String(tr.prefs.days.length), 'Days on the road')}${cell(ctx.dist(st.longestM), 'Longest drive')}</div>`;
    page.innerHTML = html;
  }

  // ---- Journal ----

  private journal(page: HTMLElement) {
    const { ctx } = this;
    const got = ctx.game.stats.data.stamps;
    type Entry = { key: string; icon: string; name: string };
    const groups: [string, string, Entry[]][] = [
      ['Regions', 'region', BIOME_IDS.map((id) => ({ key: 'region:' + id, icon: BIOMES[id].emoji, name: BIOMES[id].name }))],
      ['Landmarks', 'landmark', []], ['Sights on the road', 'sight', []], ['Places to stop', 'stop', []],
      ['The sky', 'sky', []], ['Wildlife', 'life', []], ['More finds', '', []],
    ];
    // Read the list as it is now: other features add their own stamps
    for (const s of STAMPS) {
      const kind = s.key.split(':')[0];
      if (kind === 'region') continue;
      (groups.find((x) => x[1] === kind) ?? groups[groups.length - 1])[2].push(s);
    }
    const all = groups.flatMap((x) => x[2]);
    const found = all.filter((e) => got[e.key]).length;
    let html = `<div class="jr-card"><small>Seen so far</small><b>📔 ${found} of ${all.length}</b><span>${Math.round((found / Math.max(1, all.length)) * 100)}% of everything there is to find</span>${bar(found / Math.max(1, all.length))}</div>`;
    for (const [title, , list] of groups) {
      if (!list.length) continue;
      const n = list.filter((e) => got[e.key]).length;
      html += `<h3>${title} <small>${n} of ${list.length}</small></h3><div class="jr-finds">` + list.map((e) => {
        const at = got[e.key];
        // Regions are no secret (you pick them in the garage); the rest stay a surprise until found
        const open = !!at || e.key.startsWith('region:');
        return `<div class="${at ? 'got' : ''}"><i>${open ? e.icon : '❔'}</i><b>${open ? esc(e.name) : 'Not found yet'}</b><span>${at ? date(at) : esc(hintFor(e.key))}</span></div>`;
      }).join('') + '</div>';
    }
    page.innerHTML = html;
  }

  // ---- Moods ----

  private moods(page: HTMLElement) {
    page.innerHTML = `<p class="hint">One tap sets the place, the hour and the weather, and auto-drive takes you off.</p>
      <div class="region-grid jr-moods">${MOODS.map((m) => `<button class="rtile" data-mood="${m.id}"><i>${m.icon}</i><span>${m.name}</span></button>`).join('')}</div>`;
    for (const b of page.querySelectorAll<HTMLElement>('[data-mood]')) b.onclick = () => this.applyMood(MOODS.find((m) => m.id === b.dataset.mood)!);
  }

  applyMood(m: Mood) {
    const { ctx } = this;
    const g = ctx.game;
    const s = g.settings;
    s.themes = BIOME_IDS.filter((id) => m.themes.includes(id));
    s.time = m.time;
    if (m.time === 'cycle') g.hour = 9;
    s.weather = m.weather;
    // (a mood is a choice of weather: it wins over weather that changes by itself, for now)
    g.weatherOverride = null;
    const season = s.season !== m.season;
    s.season = m.season;
    g.setThemes(s.themes);
    if (season) ctx.ui.applySetting('season');
    ctx.ui.save();
    ctx.ui.refreshGarage();
    ctx.ui.refreshSettings();
    refreshControls(ctx);
    ctx.close('journeys');
    if (g.phase === 'garage') {
      s.auto = true;
      ctx.ui.save();
      ctx.ui.refreshHud();
      ctx.ui.start();
    } else {
      ctx.ui.refreshHud();
      if (g.phase === 'paused') ctx.ui.resume();
    }
    ctx.toast(`${m.icon} ${m.name}<b>Sit back and enjoy</b>`);
  }

  // ---- After a drive ----

  showSummary() {
    const { ctx, tr } = this;
    const d = tr.drive;
    const score = d.smooth.score;
    const car = CARS.find((c) => c.id === ctx.game.vehicle.spec.id)?.name ?? '';
    const regions = d.regions.map((id) => BIOMES[id as BiomeId]).filter(Boolean);
    const label = (key: string) => {
      const s = STAMPS.find((x) => x.key === key);
      if (s) return `${s.icon} ${s.name}`;
      const b = key.startsWith('region:') ? BIOMES[key.slice(7) as BiomeId] : null;
      return b ? `${b.emoji} ${b.name}` : '';
    };
    const stamps = d.stamps.map(label).filter(Boolean);
    const rows: [string, string][] = [['Time', clock(d.s)], ['Average', ctx.speed(d.s > 5 ? d.m / d.s : 0)]];
    if (score !== null) rows.push(['Smoothness', `${score} · ${smoothWord(score)}`]);
    if (stamps.length) rows.push(['New stamps', String(stamps.length)]);
    if (d.milestones.length) rows.push(['Milestones', d.milestones.length === 1 ? d.milestones[0].text : String(d.milestones.length)]);
    if (d.trips.length) rows.push(['Arrived at', d.trips.join(', ')]);
    const list = (title: string, items: string[]) => (items.length ? `<h3>${title}</h3><div class="jr-tags">${items.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '');
    this.summary.innerHTML = `<div class="card jr-sum"><small>That was a good drive</small><b class="jr-big">${ctx.dist(d.m)}</b>
      <span class="jr-dim">${esc(car)}${regions.length ? ' · ' + regions.map((b) => b.emoji).join(' ') : ''}</span>
      <div class="jr-sum-rows">${rows.slice(0, 3).map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div>
      ${list('Through', regions.map((b) => `${b.emoji} ${b.name}`))}
      ${list('New passport stamps', stamps)}
      ${list('Milestones', d.milestones.map((m) => `${m.icon} ${m.text}`))}
      ${list("Today's ideas done", d.ideas.map((m) => `${m.icon} ${m.text}`))}
      ${list('Arrived at', d.trips)}
      <div class="jr-shot" hidden><img alt="Your trip card" /><p class="hint">Press and hold the picture to keep it, or take a screenshot.</p></div>
      <div class="jr-sum-btns"><button class="ghost small" id="jr-share">📤 Share</button><button class="go small" id="jr-done">Done</button></div></div>`;
    this.summary.classList.add('on');
    const close = () => this.summary.classList.remove('on');
    this.summary.onclick = (e) => e.target === this.summary && close();
    this.summary.querySelector<HTMLElement>('#jr-done')!.onclick = close;
    this.summary.querySelector<HTMLElement>('#jr-share')!.onclick = async () => {
      const canvas = drawCard({
        title: new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
        big: ctx.dist(d.m),
        sub: `${car}${regions.length ? ' · ' + regions.map((b) => b.name).join(', ') : ''}`,
        rows,
        foot: 'A quiet drive in Endless Drive',
      });
      const how = await shareCanvas(canvas, `I drove ${ctx.dist(d.m)} in Endless Drive${regions.length ? ' through ' + regions.map((b) => b.name).join(', ') : ''}.`);
      if (how === 'saved') ctx.toast('Saved<b>📤 Trip card downloaded</b>');
      if (how === 'shown') {
        const shot = this.summary.querySelector<HTMLElement>('.jr-shot')!;
        shot.querySelector('img')!.src = canvas.toDataURL('image/jpeg', 0.9);
        shot.hidden = false;
        shot.scrollIntoView({ block: 'nearest' });
      }
    };
  }
}

/** A nudge towards something not found yet, without giving it all away. */
function hintFor(key: string): string {
  const [kind, id] = key.split(':');
  if (kind === 'region') return 'Not visited yet';
  if (kind === 'stop') return STOP_INFO[id as keyof typeof STOP_INFO] ? 'Watch for the road signs' : 'Somewhere by the road';
  if (kind === 'landmark') return 'Out in the countryside';
  if (kind === 'sky') return 'Look up at the right moment';
  if (kind === 'life') return 'Keep your eyes open';
  return 'Somewhere along the road';
}
