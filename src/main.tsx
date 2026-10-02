import { render } from 'preact';
import { App } from './ui/App';
import { ctl } from './ui/controller';
import { loadWorld } from './sim/world';
import { tickHour } from './sim/engine';
import './ui/styles.css';

render(<App />, document.getElementById('app')!);
ctl.boot(() => loadWorld('./data/world.json'));
// handy for debugging from the devtools console
Object.assign(window as object, { __ctl: ctl, __tick: tickHour });
