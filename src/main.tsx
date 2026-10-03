import { render } from 'preact';
import { App } from './ui/terr/App';
import { ctl } from './ui/terr/controller';
import { loadWorld } from './sim/world';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import './ui/styles.css';

render(<App />, document.getElementById('app')!);
// the map draws text on a canvas, so load the cartoon font first (never wait more than 1.5s)
const fonts = Promise.all(['500', '600', '700'].map((w) => document.fonts?.load(`${w} 16px Fredoka`)));
Promise.race([fonts, new Promise((r) => setTimeout(r, 1500))]).finally(() => ctl.boot(() => loadWorld('./data/world.json')));
// handy for debugging from the devtools console
Object.assign(window as object, { __ctl: ctl });
