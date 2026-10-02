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
        <b>🗺 The map</b>
        <div>Drag to pan, pinch to zoom. Double-tap to zoom in. The 🌐 button shows a rotating globe — tap anywhere on it to dive in. Use the 🗂 button to switch map layers: political, terrain, resources, supply, unrest, alliances and weather.</div>
        <b>⚔️ Moving troops</b>
        <div>Tap one of your unit counters (gold border) to select it, then tap a province to move there. Moving into an enemy province attacks it. Long-press a province for more orders: encircle, hold, retreat, air missions, missile strikes and nuclear strikes. Turn on "Queue" to chain several moves.</div>
        <b>✏️ Front lines</b>
        <div>Tap the pencil, then drag your finger across provinces to draw a front. Choose "Hold" to spread your units along it, or "Advance" to push into the enemy beyond it.</div>
        <b>🛢 Supply</b>
        <div>Troops far from your capital, depots and ports lose supply and strength. Build supply depots, keep your sea lanes open, and use airlift wings. Cutting enemy supply lines and encircling them forces surrenders.</div>
        <b>💰 Economy</b>
        <div>Set taxes and spending, invest in sectors, and watch your resources. Shortages of oil, food, steel or electronics hurt your armies and your people. Sanctions and blockades are powerful weapons — for and against you.</div>
        <b>🤝 Diplomacy</b>
        <div>Form alliances, sign trade deals and non-aggression pacts, demand territory, impose sanctions, vote at the UN and make peace. Allies may betray you — and aggressive expansion makes neighbours band together against you.</div>
        <b>☢️ Nuclear weapons</b>
        <div>Arming warheads raises DEFCON and alarms the world. A launch devastates a province, crashes markets and may trigger retaliation. You can disable nukes when starting a game.</div>
        <b>🏆 Winning</b>
        <div>Military, economic, diplomatic, technology or survival victories — or complete a challenge. Lose your capital and most of your land, get overthrown in a coup, or let a rival conquer the world, and it's over.</div>
        <b>📱 Busy?</b>
        <div>Turn on advisors (Nation tab) to automate the economy, production, research, diplomacy or your armies. While the app is closed, your advisors keep running the country (up to 30 days) and you get a report when you return.</div>
      </div>
    </>
  );
}
