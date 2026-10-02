import { useState } from 'preact/hooks';
import { setPref } from '../platform/storage';
import { UnitIcon } from './common';
import { useCtl } from './controller';

export function Tutorial({ onDone }: { onDone: () => void }) {
  const c = useCtl();
  const g = c.game!;
  const col = g.player.color;
  const [step, setStep] = useState(0);
  const finish = () => {
    setPref('tutorial2Done', true);
    onDone();
  };
  const steps = [
    {
      title: `Welcome, leader of ${g.player.name}!`,
      body: (
        <>
          <p>Your country has a <b class="gold">gold border</b>. Drag to look around, pinch to zoom.</p>
          <p>The darker, striped areas are covered by <b>fog of war</b>: you can't see enemy troops there until your own units get close.</p>
          <p>Time is <b>paused</b>. Press <b>▶</b> (top right) to start. ▶▶ and ▶▶▶ go faster.</p>
        </>
      ),
    },
    {
      title: 'Your army',
      body: (
        <>
          <p>Each round counter is an army in a region. The number shows how many units are in it; the ring shows their health (green → red).</p>
          <div class="legend">
            <UnitIcon type="infantry" color={col} /> <span>Infantry — cheap, holds ground</span>
            <UnitIcon type="tank" color={col} /> <span>Tanks — fast, hit hard</span>
            <UnitIcon type="artillery" color={col} /> <span>Artillery — also shells nearby battles</span>
            <UnitIcon type="fighter" color={col} /> <span>Planes — strike regions in range</span>
            <UnitIcon type="warship" color={col} /> <span>Ships — fight at sea, shell coasts</span>
          </div>
        </>
      ),
    },
    {
      title: 'Moving and attacking',
      body: (
        <>
          <p><b>Drag</b> one of your counters onto a region to send it there. Or <b>tap</b> it, then tap where it should go.</p>
          <p>Moving into enemy land <b class="bad">attacks</b> it. A battle starts if they defend it. The bar over the battle shows who is winning — tap it for details.</p>
          <p>Empty enemy regions are captured after a few hours. Troops use up <b>💥 ammo</b> in battle, so keep making it.</p>
        </>
      ),
    },
    {
      title: 'Building',
      body: (
        <>
          <p>Tap <b>🔨 Build</b>, pick a building, then tap a <b class="good">green</b> region on the map:</p>
          <p>⛏️ <b>Mine</b> → materials · 🏭 <b>Factory</b> → ammo · 🪖 <b>Barracks</b> → trains troops · ✈️ <b>Airbase</b> → planes · ⚓ <b>Port</b> → ships · 🏰 <b>Fort</b> → defence</p>
          <p>Train new units in <b>⚔️ Army</b>. Your money comes from your regions — take more land, earn more.</p>
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
