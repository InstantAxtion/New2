import { describe, expect, it } from 'vitest';
import { parseYouTube, rank, score, isoDuration, coreTitle, type Candidate, type Song } from '../src/youtube';
import { parseEmbedPage } from '../src/tracks';
import { quadMatrix } from '../src/video';

describe('parseYouTube', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { videoId: 'dQw4w9WgXcQ' }],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', { videoId: 'dQw4w9WgXcQ' }],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', { videoId: 'dQw4w9WgXcQ', listId: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' }],
    ['https://music.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG', { listId: 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG' }],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', { videoId: 'dQw4w9WgXcQ' }],
    ['look at this https://youtu.be/dQw4w9WgXcQ', { videoId: 'dQw4w9WgXcQ' }],
  ])('reads %s', (input, want) => expect(parseYouTube(input)).toEqual(want));

  it.each(['', 'hello', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'https://vimeo.com/123'])('rejects %s', (s) =>
    expect(parseYouTube(s)).toBeNull(),
  );
});

const song: Song = { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200_000 };
const c = (title: string, channel: string, duration = 200, views = 1e6): Candidate => ({ id: title.slice(0, 11).padEnd(11, 'x'), title, channel, duration, views });

describe('finding the best video', () => {
  it('prefers the official music video', () => {
    const list = [
      c('The Weeknd - Blinding Lights (Lyrics)', 'Lyrics Hub', 200, 5e7),
      c('The Weeknd - Blinding Lights (Official Video)', 'TheWeekndVEVO', 262, 9e8),
      c('Blinding Lights - The Weeknd (cover)', 'Some Singer', 190, 1e5),
      c('The Weeknd - Blinding Lights (Live at the Super Bowl)', 'NFL', 240, 3e7),
    ];
    expect(rank(list, song)[0].title).toContain('Official Video');
    expect(rank(list, song, 'lyrics')[0].title).toContain('Lyrics');
  });

  it('falls back to a lyric video over unrelated or junk uploads', () => {
    const list = [
      c('Blinding Lights 1 hour loop', 'Loops', 3600, 1e6),
      c('The Weeknd - Blinding Lights (Lyric Video)', 'Vibes', 201, 2e6),
      c('The Weeknd - Save Your Tears (Official Video)', 'TheWeekndVEVO', 240, 5e8),
    ];
    expect(rank(list, song)[0].title).toContain('Lyric Video');
  });

  it('keeps junk words that are part of the song title', () => {
    const live: Song = { title: 'Live Forever', artist: 'Oasis', duration: 276_000 };
    expect(score(c('Oasis - Live Forever (Official Video)', 'Oasis', 280), live)).toBeGreaterThan(40);
  });

  it('cleans song titles', () => {
    expect(coreTitle('Stay (with Justin Bieber)')).toBe('stay');
    expect(coreTitle('Bohemian Rhapsody - Remastered 2011')).toBe('bohemian rhapsody');
  });

  it('reads ISO durations', () => {
    expect(isoDuration('PT3M42S')).toBe(222);
    expect(isoDuration('PT1H2M')).toBe(3720);
  });
});

describe('Spotify embed page', () => {
  it('reads a playlist', () => {
    const data = {
      props: { pageProps: { state: { data: { entity: {
        title: 'Road Trip', trackList: [
          { uri: 'spotify:track:1', title: 'Loser', subtitle: 'Tame Impala', duration: 223069 },
          { uri: 'spotify:track:2', title: 'Housewife', subtitle: 'Tate McRae', duration: 180000 },
        ],
      } } } } },
    };
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
    const r = parseEmbedPage(html);
    expect(r.name).toBe('Road Trip');
    expect(r.songs).toEqual([
      { title: 'Loser', artist: 'Tame Impala', duration: 223069, uri: 'spotify:track:1' },
      { title: 'Housewife', artist: 'Tate McRae', duration: 180000, uri: 'spotify:track:2' },
    ]);
  });

  it('reads a single track', () => {
    const data = { props: { pageProps: { state: { data: { entity: { name: 'Song', artists: [{ name: 'A' }, { name: 'B' }], duration: 1000 } } } } } };
    const r = parseEmbedPage(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`);
    expect(r.songs[0]).toMatchObject({ title: 'Song', artist: 'A, B' });
  });
});

describe('projecting the video onto the dashboard', () => {
  const apply = (m: string, x: number, y: number) => {
    const v = m.slice(9, -1).split(',').map(Number);
    const X = v[0] * x + v[4] * y + v[12];
    const Y = v[1] * x + v[5] * y + v[13];
    const W = v[3] * x + v[7] * y + v[15];
    return [X / W, Y / W];
  };
  it('maps the corners of the video to the screen corners', () => {
    const corners: [number, number][] = [[100, 50], [400, 80], [380, 260], [120, 220]];
    const m = quadMatrix(corners, 640, 360);
    const got = [apply(m, 0, 0), apply(m, 640, 0), apply(m, 640, 360), apply(m, 0, 360)];
    got.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(corners[i][0], 2);
      expect(p[1]).toBeCloseTo(corners[i][1], 2);
    });
  });
});
