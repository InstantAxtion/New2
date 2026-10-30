import { CapacitorHttp, Capacitor } from '@capacitor/core';
import type { Song } from './youtube';

// Time-synced lyrics from LRCLIB (lrclib.net), a free, open lyrics database.

export interface Line {
  t: number;
  text: string;
}

const cache = new Map<string, Line[] | null>();

/** Parse LRC ("[mm:ss.xx] words") into timed lines. */
export function parseLrc(lrc: string): Line[] {
  const out: Line[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

async function getJson(url: string): Promise<unknown> {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, headers: { 'Lrclib-Client': 'EndlessDrive' } });
    return r.status === 200 ? r.data : null;
  }
  const r = await fetch(url);
  return r.ok ? r.json() : null;
}

/** Synced lyrics for a song, or null if there aren't any. */
export async function fetchLyrics(song: Song): Promise<Line[] | null> {
  const artist = song.artist.split(',')[0].trim();
  const key = `${artist}|${song.title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const q = new URLSearchParams({ artist_name: artist, track_name: song.title });
  if (song.duration) q.set('duration', String(Math.round(song.duration / 1000)));
  let lines: Line[] | null = null;
  try {
    let data = (await getJson(`https://lrclib.net/api/get?${q}`)) as { syncedLyrics?: string } | null;
    if (!data?.syncedLyrics) {
      // Not an exact match: search instead and take the first one with synced lyrics
      const found = (await getJson(`https://lrclib.net/api/search?${new URLSearchParams({ artist_name: artist, track_name: song.title })}`)) as { syncedLyrics?: string }[] | null;
      data = Array.isArray(found) ? found.find((x) => x.syncedLyrics) ?? null : null;
    }
    if (data?.syncedLyrics) lines = parseLrc(data.syncedLyrics);
  } catch {
    lines = null;
  }
  cache.set(key, lines);
  return lines;
}

/** The line being sung at time t, and the one after it. */
export function lineAt(lines: Line[], t: number): { now: string; next: string } {
  let i = -1;
  for (let k = 0; k < lines.length && lines[k].t <= t; k++) i = k;
  return { now: i >= 0 ? lines[i].text : '', next: lines[i + 1]?.text ?? '' };
}
