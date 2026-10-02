import { useEffect, useRef, useState } from 'preact/hooks';
import { setPref } from '../platform/storage';
import { drawIcon } from '../render/renderer';
import { useCtl } from './controller';

/** Draws one map counter so the legend looks exactly like the map. */
function Counter({ icon, ring, color = '#3f6fb5' }: { icon: Parameters<typeof drawIcon>[1]; ring: string; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = 68;
    c.height = 52;
    const x = c.getContext('2d')!;
    x.scale(2, 2);
    x.fillStyle = color;
    x.strokeStyle = ring;
    x.lineWidth = 2.5;
    x.beginPath();
    x.roundRect(2, 2, 30, 20, 5);
    x.fill();
    x.stroke();
    x.fillStyle = '#fff';
    x.strokeStyle = '#fff';
    x.lineWidth = 1.6;
    drawIcon(x, icon, 17, 12);
  }, []);
  return <canvas ref={ref} />;
}

export function Tutorial({ onDone }: { onDone: () => void }) {
  const c = useCtl();
  const g = c.game!;
  const [step, setStep] = useState(0);
  const finish = () => {
    setPref('tutorialDone', true);
    onDone();
  };
  const steps = [
    {
      title: `Welcome, leader of ${g.player.name}!`,
      body: (
        <>
          <p>Your country has a <b class="gold">gold border</b> on the map. Drag to move around, pinch to zoom.</p>
          <p>Time is <b>paused</b>. When you're ready, press <b>▶</b> at the top right. ▶▶ and ▶▶▶ make time go faster.</p>
        </>
      ),
    },
    {
      title: 'Your forces',
      body: (
        <>
          <p>Units appear as counters. <b class="gold">Gold outline = yours</b>, <b class="bad">red outline = enemy</b>. The bar underneath shows their health.</p>
          <div class="legend">
            <Counter icon="soldier" ring="#ffd700" /> <span>Infantry — holds ground</span>
            <Counter icon="tank" ring="#ffd700" /> <span>Tanks — strong attacks</span>
            <Counter icon="gun" ring="#ffd700" /> <span>Artillery — heavy damage</span>
            <Counter icon="plane" ring="#ffd700" /> <span>Aircraft</span>
            <Counter icon="ship" ring="#ffd700" /> <span>Ships</span>
            <Counter icon="rocket" ring="#ffd700" /> <span>Missiles / air defense</span>
          </div>
        </>
      ),
    },
    {
      title: 'Giving orders',
      body: (
        <>
          <p>1. <b>Tap</b> one of your counters to select it.</p>
          <p>2. <b>Tap a province</b> to send it there. Tapping enemy land <b>attacks</b> it.</p>
          <p>3. <b>Long-press</b> anywhere for more: surround enemies, bomb, build defenses, declare war.</p>
          <p>Troops far from home run out of <b>supply</b> and weaken — keep fronts close to your land.</p>
        </>
      ),
    },
    {
      title: 'Running your country',
      body: (
        <>
          <p>🏛 <b>Country</b> — money, taxes, research and laws.</p>
          <p>⚔️ <b>Army</b> — recruit new units and select whole armies.</p>
          <p>🌍 <b>World</b> — friends, enemies, trade, alliances, wars and peace.</p>
          <p>📰 <b>News</b> — what is happening around the world.</p>
          <p>Your <b>advisors</b> already manage the budget and research. You can take over any time in 🏛 Country.</p>
        </>
      ),
    },
  ];
  const s = steps[step];
  return (
    <div class="tut" onPointerDown={(e) => e.stopPropagation()}>
      <div class="card">
        <h3>{s.title}</h3>
        {s.body}
        <div class="spread" style={{ marginTop: '12px' }}>
          <div class="dots">{steps.map((_, i) => <i class={i === step ? 'on' : ''} />)}</div>
          <div class="row">
            <button class="btn sm ghost" onClick={finish}>Skip</button>
            {step > 0 && <button class="btn sm" onClick={() => setStep(step - 1)}>Back</button>}
            <button class="btn sm primary" onClick={() => (step === steps.length - 1 ? finish() : setStep(step + 1))}>
              {step === steps.length - 1 ? "Let's go" : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
