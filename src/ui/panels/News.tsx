import { useState } from 'preact/hooks';
import type { Game } from '../../sim/ctx';
import { cededRegions, respondMessage } from '../../sim/diplomacy';
import type { NewsKind } from '../../sim/types';
import { dateStr, NationDot, Sheet, Tabs } from '../common';
import { useCtl } from '../controller';

const ICON: Record<NewsKind, string> = { war: '⚔️', peace: '🕊', economy: '💹', nuclear: '☢️', military: '🎖', diplomacy: '🤝' };

export function NewsPanel() {
  const c = useCtl();
  const g = c.game!;
  const me = g.s.player;
  const inbox = g.s.inbox.filter((m) => m.to === me && !m.resolved).length;
  const [tab, setTab] = useState<'world' | 'alerts'>('world');
  const close = () => c.open(null);
  const news = g.s.news.slice(-80).reverse();
  return (
    <Sheet title="📰 News" onClose={close} tall>
      {inbox > 0 && (
        <>
          <div class="section">📨 Messages for you ({inbox})</div>
          <Inbox g={g} />
        </>
      )}
      <Tabs tabs={[['world', '🌍 Headlines'], ['alerts', '🔔 Your alerts']]} value={tab} onChange={setTab} />
      <div class="list" style={{ marginTop: '10px' }}>
        {tab === 'world' && news.map((n) => (
          <div class="item">
            <span style={{ fontSize: '18px' }}>{ICON[n.kind] ?? '•'}</span>
            <div class="grow">
              <div class="small">{n.text}</div>
              <div class="tiny muted">{dateStr(g, n.day)}</div>
            </div>
          </div>
        ))}
        {tab === 'alerts' && g.s.toasts.slice().reverse().map((t) => (
          <div class="item click" onClick={() => { if (t.loc !== undefined) { c.focus(t.loc); close(); } }}>
            <span>{t.kind === 'danger' ? '🔴' : t.kind === 'warn' ? '🟠' : t.kind === 'good' ? '🟢' : '🔵'}</span>
            <div class="grow">
              <div class="small">{t.text}</div>
              <div class="tiny muted">{dateStr(g, t.day)}</div>
            </div>
          </div>
        ))}
        {tab === 'world' && !news.length && <div class="muted">No news yet.</div>}
      </div>
    </Sheet>
  );
}

function Inbox({ g }: { g: Game }) {
  const c = useCtl();
  const me = g.s.player;
  const msgs = g.s.inbox.filter((m) => m.to === me && !m.resolved).slice().reverse();
  const done = (text: string) => { c.toast(text); c.renderer?.invalidate(true); c.emit(); };
  return (
    <div class="list" style={{ marginBottom: '10px' }}>
      {msgs.map((m) => {
        const surrender = m.kind === 'peace' && m.terms?.kind === 'annex' && m.from !== me;
        const held = surrender ? cededRegions(g, m.from, me, { kind: 'cede' }).length : 0;
        return (
          <div class="card sel">
            <div class="row">
              <NationDot color={g.s.nations[m.from].color} />
              <b class="grow">{g.name(m.from)}</b>
              <span class="tiny muted">{dateStr(g, m.day)}</span>
            </div>
            <div class="small" style={{ marginTop: '4px' }}>{m.text}</div>
            {surrender ? (
              <div class="list" style={{ marginTop: '6px' }}>
                <button class="btn sm" onClick={() => done(respondMessage(g, m.id, true, { kind: 'annex' }))}>🏴 Take the whole country</button>
                <button class="btn sm" onClick={() => done(respondMessage(g, m.id, true, { kind: 'cede' }))}>🗺 Keep the {held} region{held === 1 ? '' : 's'} you hold</button>
                <button class="btn sm" onClick={() => done(respondMessage(g, m.id, true, { kind: 'white' }))}>🕊 Just make peace</button>
              </div>
            ) : (
              <div class="row" style={{ marginTop: '6px' }}>
                <button class="btn sm good" onClick={() => done(respondMessage(g, m.id, true))}>Accept</button>
                <button class="btn sm" onClick={() => done(respondMessage(g, m.id, false))}>Decline</button>
                {m.kind === 'peace' && <button class="btn sm ghost" onClick={() => { c.open('world', m.from); }}>See war</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
