import { useEffect, useRef, useState } from 'preact/hooks';
import { decodeOwners } from '../sim/visibility';
import { scores } from '../sim/victory';
import { dateStr, NationDot } from './common';
import { ctl, useCtl } from './controller';

export function EndScreen() {
  const c = useCtl();
  const g = c.game!;
  const over = g.s.over!;
  const ranking = scores(g).slice(0, 6);
  return (
    <div class="modal-bg">
      <div class="modal col">
        <div class="end-title">{over.won ? '🏆 VICTORY' : '💀 DEFEAT'}</div>
        <div class="center">{over.reason}</div>
        <div class="center small muted">{dateStr(g, over.day)} · {g.player.name}</div>
        <Replay />
        <div class="section">Final standings</div>
        <div class="list">
          {ranking.map((r, i) => (
            <div class="item small">
              <b style={{ width: '18px' }}>{i + 1}</b>
              <NationDot color={g.s.nations[r.n].color} />
              <span class={'grow' + (r.n === g.s.player ? ' gold' : '')}>{g.name(r.n)}</span>
              <b>{r.score}</b>
            </div>
          ))}
        </div>
        <div class="row">
          {over.won && g.player.alive && (
            <button class="btn grow" onClick={() => { g.s.over = null; g.s.settings.victory.conquest = 0; g.s.settings.victory.economic = 0; g.s.settings.victory.diplomatic = false; g.s.settings.victory.tech = false; g.s.settings.victory.endYear = 9999; ctl.emit(); }}>
              Keep playing
            </button>
          )}
          <button class="btn primary grow" onClick={() => ctl.quitToMenu()}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}

/** Timelapse of borders over the whole game. */
function Replay() {
  const g = ctl.game!;
  const ref = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const frames = g.s.replay;
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), 140);
    return () => clearInterval(id);
  }, [playing, frames.length]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !frames.length) return;
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = r.width * dpr;
    cv.height = r.height * dpr;
    const ctx = cv.getContext('2d')!;
    const geo = ctl.geo;
    const s = Math.min(cv.width / geo.width, cv.height / (geo.height - 120));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1a2e';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(s, 0, 0, s, (cv.width - geo.width * s) / 2, -60 * s);
    const own = decodeOwners(frames[Math.min(frame, frames.length - 1)].own);
    own.forEach((o, i) => {
      const n = g.s.nations[o];
      ctx.fillStyle = n ? (o === g.s.player ? '#facc15' : n.color) : '#333';
      ctx.fill(geo.paths[i], 'evenodd');
    });
  }, [frame, frames.length]);
  if (!frames.length) return null;
  const f = frames[Math.min(frame, frames.length - 1)];
  return (
    <div>
      <canvas ref={ref} class="replay" />
      <div class="spread small" style={{ marginTop: '4px' }}>
        <button class="btn sm" onClick={() => setPlaying(!playing)}>{playing ? '⏸' : '▶'}</button>
        <span class="muted">Timelapse · {dateStr(g, f.day)}</span>
        <input type="range" min={0} max={frames.length - 1} value={frame} onInput={(e) => { setPlaying(false); setFrame(+(e.target as HTMLInputElement).value); }} style={{ width: '45%' }} />
      </div>
    </div>
  );
}
