import { useState } from 'preact/hooks';
import { SettingsView } from '../Menu';
import { Sheet, Toggle } from '../common';
import { useCtl } from '../controller';

export function GameMenu() {
  const c = useCtl();
  const g = c.game!;
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [msg, setMsg] = useState<string | null>(null);
  const close = () => { c.panel = null; c.emit(); };
  const s = g.s.settings;
  return (
    <Sheet title="☰ Menu" onClose={close}>
      {view === 'main' ? (
        <div class="col">
          <div class="grid3">
            {['slot1', 'slot2', 'slot3'].map((slot, i) => (
              <button class="btn" onClick={async () => { await c.save(slot); setMsg(`Saved to slot ${i + 1}`); }}>
                💾 Save {i + 1}
              </button>
            ))}
          </div>
          {msg && <div class="small good">{msg}</div>}
          <div class="section">This game</div>
          <div class="list">
            <Toggle label="🔔 Notifications" on={s.notifications} onChange={(v) => { s.notifications = v; c.emit(); }} />
            <Toggle label="⏳ Offline progress" desc="Advisors play while you're away (max 30 days)." on={s.offlineProgress} onChange={(v) => { s.offlineProgress = v; c.emit(); }} />
            <Toggle label="🌫 Fog of war" on={s.fog} onChange={(v) => { s.fog = v; c.renderer?.invalidate(); c.emit(); }} />
          </div>
          <div class="small muted">Difficulty: {s.difficulty} · Nuclear weapons: {s.nukes ? 'on' : 'off'}</div>
          <button class="btn" onClick={() => setView('settings')}>⚙️ App settings</button>
          <button class="btn danger" onClick={() => { if (confirm('Quit to main menu? The game is autosaved.')) c.quitToMenu(); }}>
            🚪 Save &amp; quit to menu
          </button>
        </div>
      ) : (
        <SettingsView onBack={() => setView('main')} />
      )}
    </Sheet>
  );
}
