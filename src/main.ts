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
