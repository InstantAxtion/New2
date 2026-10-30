import { describe, expect, it } from 'vitest';
import { parseSpotify, embedUrl } from '../src/spotify';

const ID = '37i9dQZF1DXcBWIGoYBM5M';

describe('parseSpotify', () => {
  it.each([
    [`https://open.spotify.com/playlist/${ID}`, 'playlist'],
    [`https://open.spotify.com/playlist/${ID}?si=abc123`, 'playlist'],
    [`https://open.spotify.com/intl-de/playlist/${ID}?si=x`, 'playlist'],
    [`https://open.spotify.com/embed/album/${ID}`, 'album'],
    [`https://open.spotify.com/user/someone/playlist/${ID}`, 'playlist'],
    [`spotify:playlist:${ID}`, 'playlist'],
    [`spotify:track:${ID}`, 'track'],
    [`Check out this playlist! https://open.spotify.com/playlist/${ID}?si=1 enjoy`, 'playlist'],
    [`  https://open.spotify.com/artist/${ID}  `, 'artist'],
    [ID, 'playlist'],
  ])('accepts %s', (input, kind) => {
    const r = parseSpotify(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ref.kind).toBe(kind);
      expect(r.ref.id).toBe(ID);
    }
  });

  it.each([
    '',
    'hello',
    'https://youtube.com/playlist?list=abc',
    'https://open.spotify.com/playlist/short',
    'https://spotify.link/abcdEFG',
    'spotify:user:bob',
  ])('rejects %s', (input) => {
    expect(parseSpotify(input).ok).toBe(false);
  });

  it('builds embed urls', () => {
    const r = parseSpotify(`spotify:playlist:${ID}`);
    expect(r.ok && embedUrl(r.ref)).toBe(`https://open.spotify.com/embed/playlist/${ID}?utm_source=generator&theme=0`);
  });
});
