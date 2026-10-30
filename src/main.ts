import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import './style.css';
import { Game } from './game';
import { UI } from './ui';
import { loadSettings } from './settings';

const game = new Game(document.getElementById('view') as HTMLCanvasElement, loadSettings());
new UI(game);
requestAnimationFrame(game.frame);
(window as unknown as { game: Game }).game = game;
