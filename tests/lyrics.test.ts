import { describe, expect, it } from 'vitest';
import { lineAt, parseLrc } from '../src/lyrics';

describe('lyrics', () => {
  const lrc = '[ar:Someone]\n[00:01.50] First line\n[00:04.00] Second line\n[00:07.25][00:20.00] Chorus\n';
  it('parses timed lines, including repeated tags', () => {
    const lines = parseLrc(lrc);
    expect(lines.map((l) => l.text)).toEqual(['First line', 'Second line', 'Chorus', 'Chorus']);
    expect(lines[0].t).toBeCloseTo(1.5);
    expect(lines[3].t).toBeCloseTo(20);
  });
  it('finds the line being sung and the next one', () => {
    const lines = parseLrc(lrc);
    expect(lineAt(lines, 0.5)).toEqual({ now: '', next: 'First line' });
    expect(lineAt(lines, 5)).toEqual({ now: 'Second line', next: 'Chorus' });
    expect(lineAt(lines, 30).now).toBe('Chorus');
  });
});

import { parseDuration, parseFeed } from '../src/podcasts';

describe('podcasts', () => {
  it('reads durations in any format', () => {
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('62:03')).toBe(3723);
    expect(parseDuration('3723')).toBe(3723);
    expect(parseDuration('')).toBe(0);
  });
  it('reads episodes from an RSS feed', () => {
    const xml = `<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Show</title>
      <item><title>Ep 2</title><pubDate>Tue, 01 Oct 2024 10:00:00 GMT</pubDate><itunes:duration>30:00</itunes:duration><enclosure url="http://x.test/2.mp3" type="audio/mpeg"/></item>
      <item><title>No audio</title></item>
      <item><title>Ep 1</title><enclosure url="https://x.test/1.mp3"/></item></channel></rss>`;
    const eps = parseFeed(xml);
    expect(eps.map((e) => e.title)).toEqual(['Ep 2', 'Ep 1']);
    expect(eps[0].url).toBe('https://x.test/2.mp3');
    expect(eps[0].duration).toBe(1800);
  });
});
