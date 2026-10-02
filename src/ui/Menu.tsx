import { useEffect, useState } from 'preact/hooks';
import { SCENARIO_BY_ID } from '../data/scenarios';
import { deleteSave, pref, type SaveMeta } from '../platform/storage';
import { Toggle } from './common';
import { ctl } from './controller';

export function MainMenu() {
  const [view, setView] = useState<'main' | 'load' | 'settings' | 'help'>('main');
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    ctl.saves().then(setSaves);
  }, [view]);
  const auto = saves.find((s) => s.slot === 'autosave');
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
              Pick any country on Earth. Build, fight and conquer in real time.
            </div>
            {auto && (
              <button class="btn primary block" onClick={async () => setErr(await ctl.load('autosave'))}>
                ▶ Continue — {auto.nation}, {auto.date}
              </button>
            )}
            <button class={'btn block ' + (auto ? '' : 'primary')} onClick={() => ctl.openNewGame()}>
              🌐 New Game
            </button>
            <button class="btn block" onClick={() => setView('load')}>
              💾 Load Game
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
              <h2>Load Game</h2>
              <button class="btn sm" onClick={() => setView('main')}>
                Back
              </button>
            </div>
            {!saves.length && <div class="muted">No saved games yet.</div>}
            <div class="list">
              {saves.map((s) => (
                <div class="item">
                  <div class="grow">
                    <div>
                      <b>{s.nation}</b> · {s.date}
                    </div>
                    <div class="tiny muted">
                      {s.slot === 'autosave' ? 'Autosave' : s.slot} · {SCENARIO_BY_ID[s.scenario]?.name ?? s.scenario} · {new Date(s.savedAt).toLocaleString()}
                    </div>
                  </div>
                  <button class="btn sm primary" onClick={async () => setErr(await ctl.load(s.slot))}>
                    Load
                  </button>
                  <button
                    class="btn sm"
                    onClick={async () => {
                      await deleteSave(s.slot);
                      setSaves(await ctl.saves());
                    }}
                  >
                    🗑
                  </button>
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
        <button class="btn sm" onClick={onBack}>
          Back
        </button>
      </div>
      <div class="list">
        <Toggle label="Battery saver" desc="30 fps, lower resolution map and lighter simulation bursts." on={pref('batterySaver', false)} onChange={(v) => set('batterySaver', v)} />
        <Toggle label="Auto-pause when war is declared on you" on={pref('autoPauseWar', true)} onChange={(v) => set('autoPauseWar', v)} />
      </div>
      <div class="tiny muted">Difficulty, fog of war and nuclear weapons are chosen when you start a new game.</div>
    </>
  );
}

export function HowToPlay({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div class="spread">
        <h2>How to Play</h2>
        <button class="btn sm" onClick={onBack}>
          Back
        </button>
      </div>
      <div class="card small col">
        <b>🎯 The goal</b>
        <div>Grow your country into the strongest power — mostly by taking land. Check your progress in 🏛 Country.</div>
        <b>🗺 The map</b>
        <div>Drag to move, pinch to zoom. Your country has a gold border. Dark striped areas are hidden by fog of war. 🗂 View switches the map colours (terrain, resources, alliances). 🌐 shows a globe.</div>
        <b>⚔️ Moving troops</b>
        <div>Drag one of your round counters onto a region — or tap it, then tap the region. Going into enemy land attacks it. Tap the bar above a battle to see who is winning and why.</div>
        <b>🔨 Building</b>
        <div>Tap Build, pick a building, then tap a green region. Mines dig materials, factories make ammo, barracks/airbases/ports train units, forts help defence.</div>
        <b>📦 Resources</b>
        <div>💰 Money comes from your regions and pays for everything. ⛏ Materials build units and buildings. 💥 Ammo is used up in battles. ☢ Uranium makes nuclear warheads. Buy and sell in 🏛 Country.</div>
        <b>🌍 Friends and enemies</b>
        <div>In 🌍 World you can make allies, trade deals and peace, or declare war. Each option says whether they are likely to accept.</div>
        <b>📱 Away from the game?</b>
        <div>When you come back, the world will have moved on (1 real minute = 1 game day, up to 30 days). Your troops hold their positions.</div>
      </div>
    </>
  );
}
