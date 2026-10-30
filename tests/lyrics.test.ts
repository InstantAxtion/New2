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
