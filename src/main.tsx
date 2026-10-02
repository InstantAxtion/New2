import { render } from 'preact';
import { App } from './ui/App';
import { ctl } from './ui/controller';
import { loadWorld } from './sim/world';
import './ui/styles.css';

render(<App />, document.getElementById('app')!);
ctl.boot(() => loadWorld('./data/world.json'));
// handy for debugging from the devtools console
(window as unknown as { __ctl: typeof ctl }).__ctl = ctl;
