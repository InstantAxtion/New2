import { useCallback } from 'preact/hooks';
import { ctl, useCtl } from './controller';
import { GameScreen } from './Game';
import { MainMenu } from './Menu';
import { NewGame } from './NewGame';

export function App() {
  const c = useCtl();
  const attach = useCallback((el: HTMLDivElement | null) => {
    if (el) ctl.attachMap(el);
  }, []);
  if (c.loadError) {
    return (
      <div class="screen menu-bg">
        <div class="loading">
          <div class="big bad">Failed to load the world map</div>
          <div class="muted small">{c.loadError}</div>
        </div>
      </div>
    );
  }
  if (c.screen === 'loading') {
    return (
      <div class="screen menu-bg">
        <div class="loading">
          <div class="spinner" />
          <div class="muted">Loading the world…</div>
        </div>
      </div>
    );
  }
  const showMap = c.screen === 'game' || c.screen === 'newgame';
  return (
    <div class="screen">
      {showMap && <div class="map" ref={attach} />}
      {c.screen === 'menu' && <MainMenu />}
      {c.screen === 'newgame' && <NewGame />}
      {c.screen === 'game' && c.game?.human && <GameScreen />}
    </div>
  );
}
