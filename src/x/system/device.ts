import type { Ctx } from '../core';
import type { SystemPrefs } from './prefs';
import { makeBackup, readBackup, applyBackup } from './backup';

// Looking after the phone: frame-rate cap and battery saver, dimming the picture on long
// auto-drives, keeping the screen awake, text size, a frame-rate read-out, and backups.

interface BatteryLike { level: number; charging: boolean; addEventListener(n: string, f: () => void): void }

/** The frame-rate cap for a setting: 0 = none. `low` = the battery is low and not charging. */
export function capFor(refresh: number, low: boolean): number {
  if (refresh === -1) return low ? 30 : 0;
  return refresh > 0 ? refresh : 0;
}

export function mountDevice(ctx: Ctx, group: HTMLElement) {
  const { game } = ctx;
  const p = game.settings.x.system as SystemPrefs;

  // ----- Frame rate and battery -----
  let battery: BatteryLike | null = null;
  const low = () => !!battery && !battery.charging && battery.level <= 0.2;
  const applyCap = () => { game.fpsCap = capFor(p.refresh, low()); };
  ctx.seg(group, 'Screen refresh', 'system', 'refresh', [[0, 'Full'], [45, '45'], [30, '30'], [-1, '🔋 Auto']], (v) => {
    applyCap();
    if (v === -1) ctx.toast('Battery saver<b>🔋 Drops to 30 when the battery is low</b>');
  });
  applyCap();
  const nav = navigator as unknown as { getBattery?: () => Promise<BatteryLike> };
  nav.getBattery?.().then((b) => {
    battery = b;
    b.addEventListener('levelchange', applyCap);
    b.addEventListener('chargingchange', applyCap);
    applyCap();
  }).catch(() => {});

  // ----- Dim the picture after a while on auto-drive -----
  const dim = document.createElement('div');
  dim.id = 'xs-dim';
  document.body.appendChild(dim);
  // (by the clock on the wall, not by frames: a slow phone must not take longer to dim)
  let since = performance.now();
  let counting = false;
  const wakeUp = () => {
    since = performance.now();
    dim.classList.remove('on');
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, wakeUp, { capture: true, passive: true });
  ctx.seg(group, 'Dim on auto-drive', 'system', 'dimAfter', [[0, 'Never'], [5, '5 min'], [15, '15'], [30, '30']], wakeUp);

  // ----- Keep the screen awake -----
  type Lock = { release(): Promise<void>; released?: boolean };
  let lock: Lock | null = null;
  const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<Lock> } }).wakeLock;
  const syncLock = () => {
    const want = p.awake && game.phase === 'drive' && document.visibilityState === 'visible';
    if (want && !lock && wl) {
      wl.request('screen').then((l) => {
        lock = l;
        (l as unknown as EventTarget).addEventListener?.('release', () => { if (lock === l) lock = null; });
      }).catch(() => {});
    } else if (!want && lock) {
      void lock.release().catch(() => {});
      lock = null;
    }
  };
  ctx.seg(group, 'Keep the screen on', 'system', 'awake', [[true, 'On'], [false, 'Off']], syncLock);
  document.addEventListener('visibilitychange', syncLock);
  ctx.on('phase', syncLock);

  // ----- Text size -----
  const applyText = () => {
    document.documentElement.classList.toggle('xs-text-l', p.textSize === 1);
    document.documentElement.classList.toggle('xs-text-xl', p.textSize === 2);
    window.dispatchEvent(new Event('resize'));
  };
  ctx.seg(group, 'Text size', 'system', 'textSize', [[0, 'Normal'], [1, 'Large'], [2, 'Extra large']], applyText);
  applyText();

  // ----- Frame rate read-out -----
  const fps = document.createElement('div');
  fps.id = 'xs-fps';
  document.body.appendChild(fps);
  const applyFps = () => fps.classList.toggle('on', p.showFps);
  ctx.seg(group, 'Show frame rate', 'system', 'showFps', [[false, 'Off'], [true, 'On']], applyFps);
  applyFps();

  let fpsTimer = 0;
  ctx.use({
    update(_dt, rdt) {
      const driving = game.phase === 'drive' && (game.settings.auto || game.sleeping);
      if (p.dimAfter > 0 && driving) {
        if (!counting) wakeUp();
        counting = true;
        if (performance.now() - since > p.dimAfter * 60000) dim.classList.add('on');
      } else if (counting) {
        counting = false;
        wakeUp();
      }
      fpsTimer -= rdt;
      if (fpsTimer <= 0) {
        fpsTimer = 0.5;
        if (p.showFps) fps.textContent = `${Math.round(game.fps)} fps`;
        syncLock();
      }
    },
  });

  // ----- Backup and restore -----
  const box = document.createElement('details');
  box.className = 'sgroup advanced';
  box.innerHTML = `<summary>Backup & restore</summary>
    <p class="hint">Save everything the game remembers (settings, cars, passport, journeys, favourite places) as a code you can keep somewhere safe or move to another phone. Photos in the album are not included.</p>
    <div class="row xs-row"><button class="ghost small" id="xs-bk-make">📦 Make a backup</button><button class="ghost small" id="xs-bk-copy" hidden>📋 Copy</button><button class="ghost small" id="xs-bk-share" hidden>📤 Share</button><button class="ghost small" id="xs-bk-file" hidden>💾 Save file</button></div>
    <textarea id="xs-bk-out" class="xs-code" readonly hidden aria-label="Your backup code"></textarea>
    <h3>Restore</h3>
    <textarea id="xs-bk-in" class="xs-code" placeholder="Paste a backup code here" aria-label="Backup code to restore" spellcheck="false" autocomplete="off"></textarea>
    <div class="row xs-row"><button class="ghost small" id="xs-bk-open">📂 Open a file</button><button class="go small" id="xs-bk-restore">Restore</button></div>
    <input type="file" id="xs-bk-pick" accept=".txt,.json,text/plain,application/json" hidden />
    <p class="error" id="xs-bk-msg"></p>
    <div class="xs-confirm" id="xs-bk-confirm" hidden><p>Replace everything on this phone with the backup<span id="xs-bk-when"></span>? What you have now will be lost.</p>
      <div class="row xs-row"><button class="ghost small" id="xs-bk-no">Cancel</button><button class="go small" id="xs-bk-yes">Yes, restore</button></div></div>`;
  group.parentElement!.insertBefore(box, group.parentElement!.querySelector('.version'));
  const q = <T extends HTMLElement>(id: string) => box.querySelector('#' + id) as T;
  const out = q<HTMLTextAreaElement>('xs-bk-out'), inp = q<HTMLTextAreaElement>('xs-bk-in'), msg = q('xs-bk-msg');
  const say = (t: string, good = false) => {
    msg.textContent = t;
    msg.classList.toggle('xs-good', good);
  };
  q('xs-bk-make').onclick = () => {
    // Make sure what's in memory is what gets saved
    ctx.save();
    game.stats.save();
    out.value = makeBackup((k) => localStorage.getItem(k));
    out.hidden = false;
    q('xs-bk-copy').hidden = false;
    q('xs-bk-file').hidden = false;
    q('xs-bk-share').hidden = !(navigator as unknown as { share?: unknown }).share;
    say('Backup made. Copy it, share it or save it as a file.', true);
  };
  q('xs-bk-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(out.value);
      say('Copied.', true);
    } catch {
      out.focus();
      out.select();
      say('Press and hold the code to copy it.');
    }
  };
  q('xs-bk-share').onclick = () => {
    void (navigator as unknown as { share(d: { title: string; text: string }): Promise<void> }).share({ title: 'Endless Drive backup', text: out.value }).catch(() => {});
  };
  q('xs-bk-file').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.value], { type: 'text/plain' }));
    a.download = `endless-drive-backup-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const pick = q<HTMLInputElement>('xs-bk-pick');
  q('xs-bk-open').onclick = () => pick.click();
  pick.onchange = async () => {
    const f = pick.files?.[0];
    if (!f) return;
    if (f.size > 4e6) return say('That file is too big to be a backup.');
    inp.value = await f.text();
    pick.value = '';
    say('');
  };
  let pending: ReturnType<typeof readBackup> | null = null;
  q('xs-bk-restore').onclick = () => {
    try {
      pending = readBackup(inp.value);
    } catch (e) {
      pending = null;
      q('xs-bk-confirm').hidden = true;
      return say((e as Error).message);
    }
    say('');
    q('xs-bk-when').textContent = pending.at ? ` from ${new Date(pending.at).toLocaleDateString()}` : '';
    q('xs-bk-confirm').hidden = false;
  };
  q('xs-bk-no').onclick = () => { q('xs-bk-confirm').hidden = true; };
  q('xs-bk-yes').onclick = () => {
    if (!pending) return;
    // Stop the game writing its own copy back over the top before the reload
    const proto = Storage.prototype as unknown as { setItem(k: string, v: string): void };
    const real = proto.setItem;
    applyBackup(pending, (k, v) => real.call(localStorage, k, v));
    proto.setItem = () => {};
    location.reload();
  };
  return { applyCap, wakeUp };
}
