// Renders Android launcher icons, splash screens and the web icon from resources/*.svg.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const res = path.join(root, 'android/app/src/main/res');
const fg = fs.readFileSync(path.join(root, 'resources/icon-fg.svg'), 'utf8');
const BG = '#0b1220';
const exe = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined;
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
async function render(html, w, h, file, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : BG};overflow:hidden">${html}</body></html>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: transparent });
}
const svgAt = (size, extra = '') => fg.replace('<svg ', `<svg width="${size}" height="${size}" ${extra} `);
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(dens)) {
  const s = Math.round(48 * k);
  const iconHtml = (round) => `<div style="width:${s}px;height:${s}px;border-radius:${round ? '50%' : Math.round(s * 0.18) + 'px'};background:radial-gradient(circle at 50% 40%,#1b2d55,${BG} 70%);overflow:hidden">${svgAt(s)}</div>`;
  await render(iconHtml(false), s, s, path.join(res, `mipmap-${d}/ic_launcher.png`), true);
  await render(iconHtml(true), s, s, path.join(res, `mipmap-${d}/ic_launcher_round.png`), true);
  const f = Math.round(108 * k);
  // adaptive foreground: artwork inside the central 66% safe zone
  await render(`<div style="width:${f}px;height:${f}px;display:flex;align-items:center;justify-content:center">${svgAt(Math.round(f * 0.7))}</div>`, f, f, path.join(res, `mipmap-${d}/ic_launcher_foreground.png`), true);
  // splash screens
  for (const [orient, w, h] of [['port', 320, 480], ['land', 480, 320]]) {
    const W = Math.round(w * k), H = Math.round(h * k), L = Math.round(Math.min(W, H) * 0.42);
    const html = `<div style="width:${W}px;height:${H}px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 40%,#1b2d55,${BG} 65%);font-family:sans-serif">${svgAt(L)}<div style="color:#e6edf7;font-weight:900;font-size:${Math.round(L * 0.2)}px;letter-spacing:.04em;margin-top:${Math.round(L * 0.05)}px">SOVEREIGN</div><div style="color:#facc15;font-weight:700;font-size:${Math.round(L * 0.075)}px;letter-spacing:.4em">WORLD COMMAND</div></div>`;
    await render(html, W, H, path.join(res, `drawable-${orient}-${d}/splash.png`));
  }
}
await render(`<div style="width:480px;height:320px;display:flex;align-items:center;justify-content:center">${svgAt(200)}</div>`, 480, 320, path.join(res, 'drawable/splash.png'));
// web icon (PWA / favicon)
await render(`<div style="width:512px;height:512px;border-radius:92px;background:radial-gradient(circle at 50% 40%,#1b2d55,${BG} 70%);overflow:hidden">${svgAt(512)}</div>`, 512, 512, path.join(root, 'public/icon-512.png'), true);
fs.writeFileSync(path.join(root, 'public/icon.svg'), fg.replace('<svg ', '<svg style="background:#0b1220;border-radius:18%" '));
await browser.close();
console.log('assets generated');
