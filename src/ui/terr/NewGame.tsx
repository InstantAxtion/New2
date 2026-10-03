import { useState } from 'preact/hooks';
import { fmtTroops, type Difficulty } from '../../terr/game';
import { MODE_BY_ID, MODES } from '../../terr/setup';
import { ctl, useCtl } from './controller';
import { NationDot } from './ui';

export function NewGame() {
  const c = useCtl();
  const g = c.game;
  const mode = MODE_BY_ID[c.newMode];
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!g) return null;
  const picked = mode.start === 'country' && c.pick >= 0 ? g.s.players[c.pick] : null;
  const rank = picked ? g.ranking().findIndex((p) => p.idx === picked.idx) + 1 : 0;
  const matches = q.trim().length >= 2 ? g.s.players.filter((p) => p.alive && p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 5) : [];
  const choose = (idx: number) => {
    c.pick = idx;
    setQ('');
    const prev = g.s.player;
    g.s.player = idx;
    c.renderer?.refreshColors();
    g.s.player = prev;
    c.renderer?.flyToPlayer(idx);
    c.emit();
  };
  return (
    <>
      <div class="picker-top" style={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
        <div class="row">
          <button class="btn sm" onClick={() => ctl.quitToMenu()}>‹ Back</button>
          <b class="grow" style={{ fontSize: '18px' }}>Choose a battle</b>
        </div>
        <div class="chips">
          {MODES.map((m) => (
            <button class={'chip click' + (m.id === c.newMode ? ' on' : '')} onClick={() => { setErr(null); c.setNewMode(m.id); }}>
              {m.icon} {m.name}
            </button>
          ))}
        </div>
      </div>
      <div class="picker-bottom">
        <div class="small muted" style={{ marginBottom: '8px' }}>{mode.desc}</div>
        {mode.start === 'country' ? (
          <>
            <input type="search" placeholder="🔎 Search for a country…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            {matches.length > 0 && (
              <div class="list" style={{ marginTop: '6px' }}>
                {matches.map((p) => (
                  <button class="item click" style={{ textAlign: 'left' }} onClick={() => choose(p.idx)}>
                    <NationDot color={p.color} /> <b class="grow">{p.name}</b> <span class="tiny muted">{((p.land / g.s.playable) * 100).toFixed(1)}% of the map</span>
                  </button>
                ))}
              </div>
            )}
            {picked ? (
              <div class="card row" style={{ marginTop: '8px', gap: '12px' }}>
                <span class="dot" style={{ background: picked.color, width: '26px', height: '26px' }} />
                <div class="grow">
                  <b style={{ fontSize: '18px' }}>{picked.name}</b>
                  <div class="small muted">#{rank} by size · {((picked.land / g.s.playable) * 100).toFixed(1)}% of the map · 🪖 {fmtTroops(picked.troops)} troops</div>
                  <div class="tiny muted">{g.neighbours[picked.idx]?.size ?? 0} neighbours{rank <= 5 ? ' · a giant: easy start' : rank > 60 ? ' · tiny: a real challenge!' : ''}</div>
                </div>
              </div>
            ) : (
              <div class="help" style={{ marginTop: '8px' }}>💡 Tap a country on the map (or search) to play as it.</div>
            )}
          </>
        ) : (
          <div class={c.pick >= 0 ? 'card small' : 'help'} style={{ marginTop: '4px' }}>
            {c.pick >= 0 ? '📍 Landing spot chosen! You start as a small dot with a few troops — grab empty land fast.' : '💡 Tap any empty (sand-coloured) land on the map to choose where you start.'}
          </div>
        )}
        <div class="row" style={{ marginTop: '10px' }}>
          <div class="seg grow">
            {(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => (
              <button class={c.difficulty === d ? 'on' : ''} onClick={() => c.setDifficulty(d)}>{d === 'easy' ? '😊 Easy' : d === 'normal' ? '😐 Normal' : '😈 Hard'}</button>
            ))}
          </div>
        </div>
        <button class="btn primary block" style={{ marginTop: '10px', fontSize: '18px' }} onClick={() => setErr(c.play())}>
          ⚔️ {picked ? `Play as ${picked.name}` : mode.start === 'spawn' ? 'Land and play' : 'Play'}
        </button>
        {err && <div class="bad small center" style={{ marginTop: '6px' }}>{err}</div>}
      </div>
    </>
  );
}
