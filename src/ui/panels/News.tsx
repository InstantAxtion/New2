import { useState } from 'preact/hooks';
import type { NewsKind } from '../../sim/types';
import { dateStr, fmt, Sheet, Tabs } from '../common';
import { useCtl } from '../controller';

const ICON: Record<NewsKind, string> = { war: '⚔️', peace: '🕊', economy: '💹', politics: '🏛', disaster: '🌪', tech: '🔬', nuclear: '☢️', un: '🇺🇳', covert: '🕵️', military: '🎖', diplomacy: '🤝' };

export function NewsPanel() {
  const c = useCtl();
  const g = c.game!;
  const [tab, setTab] = useState<'world' | 'mine' | 'social' | 'alerts'>('world');
  const close = () => { c.panel = null; c.emit(); };
  const me = g.s.player;
  const news = (tab === 'mine' ? g.s.news.filter((n) => n.nations.includes(me)) : g.s.news).slice(-80).reverse();
  return (
    <Sheet title="📰 World News" onClose={close} tall>
      <Tabs tabs={[['world', '🌍 World'], ['mine', '🏳 Us'], ['social', '💬 Social feed'], ['alerts', '🔔 Alerts']]} value={tab} onChange={setTab} />
      <div class="list" style={{ marginTop: '10px' }}>
        {(tab === 'world' || tab === 'mine') && news.map((n) => (
          <div class="item">
            <span style={{ fontSize: '18px' }}>{ICON[n.kind]}</span>
            <div class="grow">
              <div class="small">{n.text}</div>
              <div class="tiny muted">{dateStr(g, n.day)}</div>
            </div>
          </div>
        ))}
        {tab === 'social' && g.s.social.slice(-40).reverse().map((p) => (
          <div class="post">
            <div class="spread">
              <span class="who">{p.author}</span>
              <span class="tiny muted">{g.name(p.nation)}</span>
            </div>
            <div class="small">{p.text}</div>
            <div class="tiny muted">❤️ {fmt.num(p.likes)} · {dateStr(g, p.day)}</div>
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
        {(tab === 'world' || tab === 'mine') && !news.length && <div class="muted">No news yet.</div>}
      </div>
    </Sheet>
  );
}
