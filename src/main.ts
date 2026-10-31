import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import './style.css';
import { Game } from './game';
import { UI } from './ui';
import { loadSettings } from './settings';
import { loadAssets } from './assets';

await loadAssets();
document.getElementById('loading')?.remove();
const game = new Game(document.getElementById('view') as HTMLCanvasElement, loadSettings());
new UI(game);
requestAnimationFrame(game.frame);
(window as unknown as { game: Game }).game = game;

// If the phone takes the graphics away (low memory, the video player starting up…), don't sit on a
// black screen or close: reload into the garage. Settings and the drive are saved as you go.
const canvas = document.getElementById('view') as HTMLCanvasElement;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  setTimeout(() => location.reload(), 600);
});
// Keep going after a stray error in one frame rather than freezing
window.addEventListener('error', (e) => console.warn('Recovered from', e.message));
