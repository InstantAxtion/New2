import { useEffect, useState } from 'preact/hooks';
import { deleteSave, pref, type SaveMeta } from '../../platform/storage';
import { MODE_BY_ID } from '../../terr/setup';
import type { Mode } from '../../terr/game';
import { ctl } from './controller';
import { Toggle } from './ui';

export function MainMenu() {
  const [view, setView] = useState<'main' | 'load' | 'settings' | 'help'>('main');
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    ctl.saves().then(setSaves);
  }, [view]);
  const auto = saves.find((s) => s.slot === 'autosave' && MODE_BY_ID[s.scenario as Mode]);
  return (
    <div class="screen menu-bg">
      <div class="menu-wrap scroll" style={{ maxHeight: '100%' }}>
        {view === 'main' && (
          <>
            <div class="globe-deco">🌍</div>
            <div class="title">
              SOVEREIGN<span>WORLD COMMAND</span>
            </div>
            <div class="muted center small" style={{ marginBottom: '14px' }}>
              Send your troops, swallow your neighbours, paint the world your colour.
            </div>
            {auto && (
              <button class="btn primary block" onClick={async () => setErr(await ctl.load('autosave'))}>
                ▶ Continue — {auto.nation} ({auto.date})
              </button>
            )}
            <button class={'btn block ' + (auto ? '' : 'primary')} onClick={() => ctl.openNewGame()}>
              ⚔️ Play
            </button>
            <button class="btn block" onClick={() => setView('load')}>
              💾 Saved games
            </button>
            <button class="btn block" onClick={() => setView('settings')}>
              ⚙️ Settings
            </button>
            <button class="btn block" onClick={() => setView('help')}>
              📖 How to Play
            </button>
            {err && <div class="bad small center">{err}</div>}
            <div class="tiny muted center" style={{ marginTop: '18px' }}>
              Single-player · Offline · No in-game purchases
              <br />
              Map data: Natural Earth (public domain)
            </div>
          </>
        )}
        {view === 'load' && (
          <>
            <div class="spread">
              <h2>Saved games</h2>
              <button class="btn sm" onClick={() => setView('main')}>Back</button>
            </div>
            {!saves.length && <div class="muted">No saved games yet. The game saves by itself while you play.</div>}
            <div class="list">
              {saves.map((s) => (
                <div class="item">
                  <div class="grow">
                    <div><b>{s.nation}</b> · {s.date}</div>
                    <div class="tiny muted">
                      {s.slot === 'autosave' ? 'Autosave' : s.slot} · {MODE_BY_ID[s.scenario as Mode]?.name ?? 'old version'} · {new Date(s.savedAt).toLocaleString()}
                    </div>
                  </div>
                  <button class="btn sm primary" onClick={async () => setErr(await ctl.load(s.slot))}>Load</button>
                  <button class="btn sm" aria-label="Delete" onClick={async () => { await deleteSave(s.slot); setSaves(await ctl.saves()); }}>🗑</button>
                </div>
              ))}
            </div>
            {err && <div class="bad small">{err}</div>}
          </>
        )}
        {view === 'settings' && <SettingsView onBack={() => setView('main')} />}
        {view === 'help' && <HowToPlay onBack={() => setView('main')} />}
      </div>
    </div>
  );
}

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [, force] = useState(0);
  const set = (k: string, v: unknown) => {
    ctl.setPref(k, v);
    force((x) => x + 1);
  };
  return (
    <>
      <div class="spread">
        <h2>Settings</h2>
        <button class="btn sm" onClick={onBack}>Back</button>
      </div>
      <div class="list">
        <Toggle label="Vibration" desc="A little buzz when you attack, conquer or get attacked." on={pref('vibration', true)} onChange={(v) => set('vibration', v)} />
        <Toggle label="Battery saver" desc="30 fps and a lighter map. Try this if your phone gets warm." on={pref('batterySaver', false)} onChange={(v) => set('batterySaver', v)} />
      </div>
    </>
  );
}

export function HowToPlay({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div class="spread">
        <h2>How to Play</h2>
        <button class="btn sm" onClick={onBack}>Back</button>
      </div>
      <div class="card small col">
        <b>🎯 The goal</b>
        <div>Own 60% of the land, or be the last one standing.</div>
        <b>🪖 Troops</b>
        <div>Troops are everything. They grow on their own — faster with more land, and land full of people is worth more than empty tundra. There's a limit to how many you can hold, so don't sit on them: use them!</div>
        <b>⚔️ Attacking</b>
        <div>Set the slider at the bottom to how many of your troops to send, then tap a neighbour (or empty land). Your colour floods across the whole shared border until those troops run out. Crowded, well-defended land and mountains cost more troops per pixel.</div>
        <b>⛵ Boats</b>
        <div>Tap a coast you don't border to send troops by sea. Up to 3 boats at a time.</div>
        <b>🤝 Allies</b>
        <div>Neighbours sometimes offer an alliance — allies can't attack each other. Long-press any country to see its strength, ask it to be your ally, or break an alliance.</div>
        <b>🗺 The map</b>
        <div>Swipe (and flick) to move, pinch or double-tap to zoom. 🏠 brings you home. The game saves by itself.</div>
      </div>
    </>
  );
}
