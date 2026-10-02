import { useState } from 'preact/hooks';
import { TECH_CATS, TECHS, TECH_BY_ID, type TechCat } from '../../data/techs';
import { canResearch, setResearch, techCost } from '../../sim/tech';
import { Bar, Sheet, Tabs, Toggle } from '../common';
import { useCtl } from '../controller';

export function ResearchPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const [cat, setCat] = useState<TechCat>('land');
  const close = () => { c.panel = null; c.emit(); };
  const cur = n.researching ? TECH_BY_ID[n.researching] : null;
  const curCost = n.researching ? techCost(g, n.idx, n.researching) : 0;
  const rpDay = n.history.length ? null : null;
  void rpDay;
  return (
    <Sheet title="🔬 Research" onClose={close} tall>
      <div class="card">
        {cur ? (
          <>
            <div class="spread"><b>{cur.name}</b><span class="small muted">{Math.round(n.rp)} / {Math.round(curCost)} RP</span></div>
            <Bar v={n.rp / curCost} color="var(--gold)" />
            <div class="tiny muted" style={{ marginTop: '4px' }}>{cur.desc}</div>
          </>
        ) : (
          <div class="muted">No active research — pick a technology below. ({Math.round(n.rp)} RP banked)</div>
        )}
        {n.techQueue.length > 0 && <div class="tiny muted" style={{ marginTop: '6px' }}>Queued: {n.techQueue.map((t) => TECH_BY_ID[t]?.name).join(' → ')}</div>}
        <div class="tiny muted" style={{ marginTop: '6px' }}>Research speed rises with your research budget and tech sector. Technologies known by many nations are cheaper; ones ahead of their time cost more.</div>
      </div>
      <div style={{ marginTop: '8px' }}>
        <Toggle label="Research advisor" desc="Automatically choose the next technology." on={n.advisors.research} onChange={(v) => { n.advisors.research = v; c.emit(); }} />
      </div>
      <div style={{ margin: '10px 0' }}>
        <Tabs<TechCat> tabs={TECH_CATS.map((t) => [t.id, t.name])} value={cat} onChange={setCat} />
      </div>
      <div class="list">
        {TECHS.filter((t) => t.cat === cat).map((t) => {
          const done = n.techs.includes(t.id);
          const avail = canResearch(g, n.idx, t.id);
          const isCur = n.researching === t.id;
          const queued = n.techQueue.includes(t.id);
          return (
            <div class={'tech ' + (isCur ? 'cur' : done ? 'done' : avail ? 'avail' : 'locked')}>
              <div class="spread">
                <b class="small">{done ? '✅ ' : ''}{t.name}</b>
                <span class="tiny muted">{t.year} · {Math.round(techCost(g, n.idx, t.id))} RP</span>
              </div>
              <div class="tiny muted">{t.desc}</div>
              {!done && !avail && t.req.length > 0 && <div class="tiny warn">Requires: {t.req.map((r) => TECH_BY_ID[r].name).join(', ')}</div>}
              {avail && !isCur && (
                <div class="row" style={{ marginTop: '6px' }}>
                  <button class="btn sm primary" onClick={() => { setResearch(g, n.idx, t.id); c.emit(); }}>Research now</button>
                  {n.researching && <button class="btn sm" disabled={queued} onClick={() => { setResearch(g, n.idx, t.id, true); c.emit(); }}>{queued ? 'Queued' : 'Queue'}</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
