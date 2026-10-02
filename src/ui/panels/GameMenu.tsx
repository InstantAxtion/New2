import { useState } from 'preact/hooks';
import { SettingsView } from '../Menu';
import { Action, Sheet } from '../common';
import { useCtl } from '../controller';

export function GameMenu() {
  const c = useCtl();
  const [view, setView] = useState<'main' | 'settings'>('main');
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Sheet title="☰ Menu" onClose={() => c.open(null)}>
      {view === 'main' ? (
        <div class="list">
          <Action icon="💾" title="Save game" desc="The game also saves itself automatically." onClick={async () => { await c.save('slot1'); setMsg('Game saved.'); }} />
          {msg && <div class="small good">{msg}</div>}
          <Action icon="📖" title="How to play" desc="Show the quick tutorial again." onClick={() => { c.open(null); window.dispatchEvent(new Event('show-tutorial')); }} />
          <Action icon="⚙️" title="Settings" desc="Battery saver and display options." onClick={() => setView('settings')} />
          <Action icon="🚪" title="Quit to main menu" desc="Your progress is saved." tone="bad" onClick={() => c.quitToMenu()} />
        </div>
      ) : (
        <SettingsView onBack={() => setView('main')} />
      )}
    </Sheet>
  );
}
