import { scores } from '../sim/victory';
import { dateStr, NationDot, Spark } from './common';
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
        <History />
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
            <button class="btn grow" onClick={() => { g.s.over = null; g.s.settings.victory.conquest = 0; g.s.settings.victory.endYear = 9999; ctl.emit(); }}>
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

/** How your nation grew over the game. */
function History() {
  const g = ctl.game!;
  const h = g.player.history;
  if (h.length < 2) return null;
  return (
    <div class="grid2">
      <div class="card"><div class="tiny muted">Regions</div><Spark values={h.map((x) => x.regions)} color="#facc15" /></div>
      <div class="card"><div class="tiny muted">Army size</div><Spark values={h.map((x) => x.army)} color="#f87171" /></div>
    </div>
  );
}
