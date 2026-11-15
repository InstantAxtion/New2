import type { Ctx } from '../core';
import { mountSkyTime } from './skytime';
import { mountSound } from './sound';
import { mountDevice } from './device';
import { mountWelcome } from './welcome';
import './system.css';

export { addTips, WHATS_NEW, OVERHAUL_VERSION } from './welcome';

/** Weather and time, sound, looking after the phone, and the welcome (called once, after the main UI is built). */
export function mountSystem(ctx: Ctx) {
  const sky = ctx.settingsGroup('Weather & time');
  const skytime = mountSkyTime(ctx, sky);
  const sound = mountSound(ctx, sky);
  const phone = ctx.settingsGroup('Your phone');
  const device = mountDevice(ctx, phone);
  const welcome = mountWelcome(ctx);
  // (for tests and for other feature groups)
  (ctx.game as unknown as { system: unknown }).system = { skytime, sound, device, welcome };
}
