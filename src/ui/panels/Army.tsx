import { NUKE_URANIUM, UNITS } from '../../data/units';
import { canBuild, enqueue, unitCost } from '../../sim/economy';
import { setArmed } from '../../sim/nuclear';
import type { Domain, UnitType } from '../../sim/types';
import { Action, Bar, fmt, Help, Sheet } from '../common';
import { useCtl } from '../controller';

/** What each unit is for, in one sentence. */
const ROLE: Partial<Record<UnitType, string>> = {
  infantry: 'Cheap, all-round troops. Best at holding ground.',
  armor: 'Fast, powerful attackers. Weak in mountains and jungle.',
  artillery: 'Heavy damage in battles, but slow.',
  airdef: 'Shoots down enemy planes and missiles nearby.',
  missile: 'Strikes enemy troops far away (long-press a province).',
  fighter: 'Wins control of the sky and supports your battles.',
  bomber: 'Bombs enemy troops and factories far behind the front.',
  drone: 'Cheap air strikes and scouting.',
  destroyer: 'All-round warship. Good at hunting submarines.',
  submarine: 'Sinks ships and cuts enemy trade.',
  carrier: 'A floating airbase. Very strong, very expensive.',
  battleship: 'Heavy warship with huge guns.',
  amphib: 'Carries your troops across the sea for invasions.',
};
const BUILDABLE: Record<Domain, UnitType[]> = {
  land: ['infantry', 'armor', 'artillery', 'airdef', 'missile'],
  air: ['fighter', 'bomber', 'drone'],
  sea: ['destroyer', 'submarine', 'carrier', 'battleship', 'amphib'],
};
const ICON: Record<Domain, string> = { land: '🪖', air: '✈️', sea: '⚓' };
const LABEL: Record<Domain, string> = { land: 'Army', air: 'Air force', sea: 'Navy' };

export function ArmyPanel() {
  const c = useCtl();
  const g = c.game!;
  const n = g.player;
  const units = g.unitsOf(n.idx);
  const count = (d: Domain) => units.filter((u) => UNITS[u.type].domain === d).length;
  const close = () => c.open(null);
  const selectAll = (d: Domain) => {
    c.select(units.filter((u) => UNITS[u.type].domain === d && (d !== 'land' || u.loc >= 0)).map((u) => u.id));
    c.open(null);
    c.toast(`${count(d)} ${LABEL[d].toLowerCase()} units selected — now tap where to send them`, 'info');
  };
  return (
    <Sheet title="⚔️ Army" onClose={close} tall>
      <div class="grid3">
        {(['land', 'air', 'sea'] as Domain[]).map((d) => (
          <button class="stat" style={{ textAlign: 'left' }} onClick={() => selectAll(d)}>
            <div class="l">{ICON[d]} {LABEL[d]}</div>
            <div class="v">{count(d)}</div>
            <div class="tiny muted">tap to select all</div>
          </button>
        ))}
      </div>
      <div class="spread small" style={{ marginTop: '8px' }}>
        <span>👥 Recruits available: <b>{fmt.num(n.manpower)}k</b></span>
        <span class={n.readiness < 0.95 ? 'bad' : 'muted'}>{n.readiness < 0.95 ? '⚠️ troops underpaid' : 'troops fully paid'}</span>
      </div>
      {n.readiness < 0.95 && <Help>Your military budget doesn't cover your army's pay, so units are weaker. Raise military spending in 🏛 Country (or let the advisor do it).</Help>}

      {n.queue.length > 0 && (
        <>
          <div class="section">🏭 Being built</div>
          <div class="list">
            {n.queue.map((q) => {
              const name = q.type === 'nuke' ? 'Nuclear warhead' : q.type === 'depot' ? 'Supply depot' : q.type === 'fort' ? 'Fortifications' : q.type === 'infra' ? 'Infrastructure' : UNITS[q.type as UnitType].name;
              return (
                <div class="item">
                  <div class="grow">
                    <div class="small">{name} <span class="tiny muted">· {g.locName(q.at)}</span></div>
                    <Bar v={q.progress / q.cost} />
                    <div class="tiny muted">{q.progress >= q.cost - 1e-6 ? `ready in ${q.days} days` : q.days > 0 ? `at least ${q.days} more days` : 'waiting for money (raise military spending)'}</div>
                  </div>
                  <button class="btn sm" aria-label="Cancel" onClick={() => { n.queue = n.queue.filter((x) => x !== q); n.treasury += q.progress * 0.5; c.emit(); }}>✕</button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div class="section">➕ Recruit</div>
      <Help>New units appear at your capital (ships at your biggest port) and are paid from your military budget.</Help>
      {(['land', 'air', 'sea'] as Domain[]).map((d) => {
        const list = BUILDABLE[d].filter((t) => !(t === 'battleship' && g.hasTech(n.idx, 'carriers')) && g.hasTech(n.idx, UNITS[t].tech));
        if (!list.length) return null;
        return (
          <>
            <div class="small muted" style={{ margin: '8px 0 4px' }}>{ICON[d]} {LABEL[d]}</div>
            <div class="list">
              {list.map((t) => {
                const err = canBuild(g, n.idx, t);
                return (
                  <Action icon={ICON[d]} title={UNITS[t].name} desc={<>{ROLE[t]} <span class="muted">· {fmt.money(unitCost(g, n, t))} · {UNITS[t].days} days</span>{err && <span class="warn"> · {err}</span>}</>}>
                    <button class="btn sm primary" disabled={!!err} onClick={() => { const e = enqueue(g, n.idx, t); c.toast(e ?? `${UNITS[t].name} ordered`, e ? 'warn' : 'good'); }}>
                      Build
                    </button>
                  </Action>
                );
              })}
            </div>
          </>
        );
      })}

      {g.s.settings.nukes && (n.nukes > 0 || g.mod(n.idx, 'nukes') > 0) && (
        <>
          <div class="section">☢️ Nuclear weapons</div>
          <div class="card col">
            <div class="spread">
              <span>Warheads: <b>{n.nukes}</b></span>
              <span class={n.nukesArmed ? 'bad' : 'good'}>{n.nukesArmed ? 'ARMED' : 'Safe'}</span>
            </div>
            <div class="tiny muted">Arming warns the whole world and raises tension (DEFCON). Once armed, long-press an enemy province to strike. A nuclear strike destroys a province, crashes world markets and may bring retaliation.</div>
            <button class={'btn sm ' + (n.nukesArmed ? '' : 'danger')} disabled={!n.nukes && !n.nukesArmed} onClick={() => { const e = setArmed(g, n.idx, !n.nukesArmed); if (e) c.toast(e, 'warn'); c.emit(); }}>
              {n.nukesArmed ? 'Stand down (disarm)' : 'Arm nuclear weapons'}
            </button>
            <button class="btn sm" disabled={!!canBuild(g, n.idx, 'nuke')} onClick={() => { const e = enqueue(g, n.idx, 'nuke'); c.toast(e ?? 'Warhead production started', e ? 'warn' : 'good'); }}>
              Build a warhead ({fmt.money(unitCost(g, n, 'nuke'))}, needs {NUKE_URANIUM} uranium)
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
