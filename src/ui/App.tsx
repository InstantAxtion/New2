import { useCallback } from 'preact/hooks';
import { ctl, useCtl } from './controller';
import { GameScreen } from './GameScreen';
import { MainMenu } from './Menu';
import { NewGame } from './NewGame';

export function App() {
  const c = useCtl();
  const attach = useCallback((el: HTMLCanvasElement | null) => {
    if (el) ctl.attachCanvas(el);
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
      {showMap && <canvas class="map" ref={attach} />}
      {c.screen === 'menu' && <MainMenu />}
      {c.screen === 'newgame' && <NewGame />}
      {c.screen === 'game' && c.game && <GameScreen />}
    </div>
  );
}
