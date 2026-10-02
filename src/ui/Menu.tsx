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
              Rule any nation on Earth. Real-time war, economy, diplomacy &amp; intrigue.
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
        <Toggle label="Show news ticker" on={pref('ticker', true)} onChange={(v) => set('ticker', v)} />
        <Toggle label="Auto-pause when war is declared on you" on={pref('autoPauseWar', true)} onChange={(v) => set('autoPauseWar', v)} />
      </div>
      <div class="tiny muted">Per-game options (nuclear weapons, fog of war, difficulty, notifications, offline progress) are set when starting a game and in the in-game menu.</div>
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
        <div>Lead your country to the top — by conquest, by building the biggest economy, through diplomacy, or by winning the space race. Check your progress in 🏛 Country.</div>
        <b>🗺 The map</b>
        <div>Drag to move, pinch to zoom, double-tap to zoom in. Your country has a gold border. 🗂 View changes what the map shows (terrain, supply, alliances, weather). 🌐 shows a globe.</div>
        <b>⚔️ Moving troops</b>
        <div>Tap one of your counters (gold outline) to select it, then tap a province to send it there. Tapping enemy land attacks it. In ⚔️ Army you can select your whole army, air force or navy at once.</div>
        <b>👆 Long-press</b>
        <div>Hold your finger on any province for more options: surround enemies, bomb, build defenses, talk to its owner or declare war.</div>
        <b>📦 Supply</b>
        <div>Troops far from your land run out of supplies and weaken. Build supply depots near the front (long-press your province).</div>
        <b>🏛 Running the country</b>
        <div>Advisors manage your budget and research from the start. You can take over in 🏛 Country. Keep people happy (approval) or you may lose elections — or face a coup.</div>
        <b>🌍 Friends and enemies</b>
        <div>In 🌍 World you can trade, make alliances, put sanctions on rivals, send spies, declare war and make peace. Each option says whether they are likely to accept.</div>
        <b>☢️ Nukes</b>
        <div>Some countries have nuclear weapons. Using them is devastating and turns the whole world against you. You can turn them off when starting a game.</div>
        <b>📱 Away from the game?</b>
        <div>When you come back, your advisors will have played for you (1 real minute = 1 game day, up to 30 days) and you get a report.</div>
      </div>
    </>
  );
}
