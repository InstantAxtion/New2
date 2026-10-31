// YouTube: parse links, find the best video for a song through the official
// YouTube Data API (needs the player's own free API key), and remember choices.

export interface YtLink {
  videoId?: string;
  listId?: string;
}

const VID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTube(input: string): YtLink | null {
  const found = input.trim().match(/https?:\/\/[^\s]+/i);
  const s = found ? found[0] : input.trim();
  if (VID.test(s)) return { videoId: s };
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let videoId: string | undefined;
  if (host === 'youtu.be') videoId = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    videoId = url.searchParams.get('v') ?? undefined;
    const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    if (m) videoId = m[1];
  } else return null;
  const listId = url.searchParams.get('list') ?? undefined;
  const out: YtLink = {};
  if (videoId && VID.test(videoId)) out.videoId = videoId;
  if (listId && /^[A-Za-z0-9_-]{10,}$/.test(listId)) out.listId = listId;
  return out.videoId || out.listId ? out : null;
}

export interface Song {
  title: string;
  /** Artists, comma separated. */
  artist: string;
  /** Milliseconds, 0 if unknown. */
  duration: number;
  uri?: string;
}

export interface Candidate {
  id: string;
  title: string;
  channel: string;
  /** Seconds, 0 if unknown. */
  duration: number;
  views: number;
}

export type Prefer = 'video' | 'lyrics';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&quot;/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The song title without "(feat. …)", "- Remastered" and similar. */
export function coreTitle(t: string): string {
  return norm(t.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '')) || norm(t);
}

const JUNK = ['live', 'cover', 'reaction', 'karaoke', 'instrumental', 'remix', 'sped up', 'slowed', '8d', 'nightcore', 'hour', 'loop',
  'tutorial', 'piano', 'guitar', 'drum', 'bass boosted', 'acoustic', 'concert', 'behind the scenes', 'teaser', 'trailer', 'shorts', 'mashup', 'parody'];

/** How good a match a video is for a song. Higher is better. */
export function score(c: Candidate, song: Song, prefer: Prefer = 'video'): number {
  const t = norm(c.title);
  const ch = norm(c.channel);
  const want = coreTitle(song.title);
  const songN = norm(song.title);
  const artists = song.artist.split(',').map(norm).filter(Boolean);
  let s = 0;

  const isVideo = /official (music )?video|\bmusic video\b|\bofficial mv\b|\bm v\b/.test(t);
  const isLyric = /lyric|lyrics/.test(t);
  if (/official music video/.test(t)) s += 42;
  else if (/official video/.test(t)) s += 36;
  else if (isVideo) s += 28;
  if (isLyric) s += /official/.test(t) ? 26 : 20;
  if (prefer === 'lyrics') {
    if (isLyric) s += 30;
    if (isVideo && !isLyric) s -= 10;
  }
  if (/official audio|visuali[sz]er/.test(t)) s += 8;

  // Right song?
  if (want && t.includes(want)) s += 18;
  else s -= 30;
  // Right artist (title or channel)?
  const main = artists[0] ?? '';
  const chanMatch = main && (ch.replace(/ /g, '').includes(main.replace(/ /g, '')) || ch.endsWith('vevo'));
  if (chanMatch) s += 22;
  else if (artists.some((a) => a && t.includes(a))) s += 10;
  else s -= 15;
  if (/ topic$/.test(ch)) s -= 6;

  for (const j of JUNK) if (t.includes(j) && !songN.includes(j)) s -= 35;

  if (song.duration && c.duration) {
    const d = Math.abs(c.duration - song.duration / 1000);
    if (d < 20) s += 10;
    else if (d > 150) s -= 18;
    if (c.duration > 900) s -= 40;
  }
  s += Math.log10(Math.max(c.views, 1)) * 2;
  return s;
}

export function rank(cands: Candidate[], song: Song, prefer: Prefer = 'video'): Candidate[] {
  return cands
    .map((c) => ({ c, s: score(c, song, prefer) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

/** "PT3M42S" -> 222 */
export function isoDuration(s: string): number {
  const m = s.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

const API = 'https://www.googleapis.com/youtube/v3';

export class QuotaError extends Error {}
export class KeyError extends Error {}

/** Search YouTube for a song's video (official Data API). */
export async function searchSong(song: Song, key: string, prefer: Prefer): Promise<Candidate[]> {
  const main = song.artist.split(',')[0];
  const q = `${main} ${song.title.replace(/\s*[([].*?[)\]]/g, '')} ${prefer === 'lyrics' ? 'lyrics' : 'official music video'}`;
  const sp = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '10', q, key });
  const res = await fetch(`${API}/search?${sp}`);
  const j = await res.json();
  if (!res.ok) {
    const reason = j?.error?.errors?.[0]?.reason ?? '';
    if (/quota/i.test(reason)) throw new QuotaError('YouTube daily search limit reached');
    if (res.status === 400 || res.status === 403) throw new KeyError(j?.error?.message ?? 'YouTube API key rejected');
    throw new Error(j?.error?.message ?? `YouTube search failed (${res.status})`);
  }
  const items: { id: { videoId: string }; snippet: { title: string; channelTitle: string } }[] = j.items ?? [];
  const ids = items.map((i) => i.id.videoId).filter(Boolean);
  if (!ids.length) return [];
  const info = new Map<string, { duration: number; views: number }>();
  try {
    const r2 = await fetch(`${API}/videos?${new URLSearchParams({ part: 'contentDetails,statistics', id: ids.join(','), key })}`);
    const j2 = await r2.json();
    for (const v of j2.items ?? []) {
      info.set(v.id, { duration: isoDuration(v.contentDetails?.duration ?? ''), views: Number(v.statistics?.viewCount ?? 0) });
    }
  } catch {
    /* durations are a bonus */
  }
  const cands = items.map((i) => ({
    id: i.id.videoId,
    title: decode(i.snippet.title),
    channel: decode(i.snippet.channelTitle),
    duration: info.get(i.id.videoId)?.duration ?? 0,
    views: info.get(i.id.videoId)?.views ?? 0,
  }));
  return rank(cands, song, prefer);
}

function decode(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

// ---- Remembered choices (saves API quota and keeps the player's own picks) ----

const KEY = 'endless-drive.videos';
export interface CacheEntry {
  cands: Candidate[];
  /** Index of the chosen candidate, or -1 when the player pasted their own link. */
  pick: number;
  custom?: string;
}

export const songKey = (s: Song) => s.uri || `${norm(s.artist)}|${norm(s.title)}`;

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function cached(s: Song, prefer: Prefer): CacheEntry | null {
  return readCache()[songKey(s) + '#' + prefer] ?? null;
}

export function remember(s: Song, prefer: Prefer, e: CacheEntry) {
  const c = readCache();
  c[songKey(s) + '#' + prefer] = e;
  const keys = Object.keys(c);
  // Keep the cache small
  for (const k of keys.slice(0, Math.max(0, keys.length - 800))) delete c[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

// ---- Searching YouTube directly, and someone's own channel ----

export interface YtResult {
  kind: 'video' | 'playlist';
  id: string;
  title: string;
  channel: string;
  thumb: string;
  /** Seconds (videos), 0 if unknown. */
  duration: number;
  /** Number of videos (playlists). */
  count?: number;
}

async function api(path: string, params: Record<string, string>, key: string) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key })}`);
  const j = await res.json();
  if (!res.ok) {
    const reason = j?.error?.errors?.[0]?.reason ?? '';
    if (/quota/i.test(reason)) throw new QuotaError('YouTube daily search limit reached');
    if (res.status === 400 || res.status === 403) throw new KeyError(j?.error?.message ?? 'YouTube API key rejected');
    throw new Error(j?.error?.message ?? `YouTube request failed (${res.status})`);
  }
  return j;
}

/** Search YouTube for videos (that play inside the app) or playlists. */
export async function searchYouTube(q: string, key: string, kind: 'video' | 'playlist'): Promise<YtResult[]> {
  const params: Record<string, string> = { part: 'snippet', type: kind, maxResults: '20', q };
  if (kind === 'video') params.videoEmbeddable = 'true';
  const j = await api('search', params, key);
  type Item = { id: { videoId?: string; playlistId?: string }; snippet: { title: string; channelTitle: string; thumbnails?: { medium?: { url: string }; default?: { url: string } } } };
  const items: Item[] = j.items ?? [];
  const out: YtResult[] = items
    .map((i) => ({
      kind,
      id: (kind === 'video' ? i.id.videoId : i.id.playlistId) ?? '',
      title: decode(i.snippet.title),
      channel: decode(i.snippet.channelTitle),
      thumb: i.snippet.thumbnails?.medium?.url ?? i.snippet.thumbnails?.default?.url ?? '',
      duration: 0,
    }))
    .filter((r) => r.id);
  if (kind === 'video' && out.length) {
    try {
      const j2 = await api('videos', { part: 'contentDetails', id: out.map((r) => r.id).join(',') }, key);
      const d = new Map<string, number>((j2.items ?? []).map((v: { id: string; contentDetails?: { duration?: string } }) => [v.id, isoDuration(v.contentDetails?.duration ?? '')]));
      for (const r of out) r.duration = d.get(r.id) ?? 0;
    } catch {
      /* durations are a bonus */
    }
  }
  return out;
}

/** A channel's public playlists, from its @handle, channel link or channel id. */
export async function channelPlaylists(who: string, key: string): Promise<{ channel: string; lists: YtResult[] }> {
  const w = who.trim();
  const idMatch = w.match(/(UC[\w-]{22})/);
  const handle = w.match(/@([\w.-]+)/)?.[1] ?? (idMatch ? null : w.replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/^@/, ''));
  const ch = await api('channels', idMatch ? { part: 'snippet', id: idMatch[1] } : { part: 'snippet', forHandle: handle ?? '' }, key);
  const c = ch.items?.[0];
  if (!c) throw new Error("Couldn't find that channel. Use your @handle from youtube.com.");
  const pl = await api('playlists', { part: 'snippet,contentDetails', channelId: c.id, maxResults: '50' }, key);
  type P = { id: string; snippet: { title: string; channelTitle: string; thumbnails?: { medium?: { url: string } } }; contentDetails?: { itemCount?: number } };
  const lists: YtResult[] = (pl.items ?? []).map((p: P) => ({
    kind: 'playlist' as const,
    id: p.id,
    title: decode(p.snippet.title),
    channel: decode(p.snippet.channelTitle),
    thumb: p.snippet.thumbnails?.medium?.url ?? '',
    duration: 0,
    count: p.contentDetails?.itemCount ?? 0,
  }));
  // Their uploads too, as a playlist
  const uploads = 'UU' + c.id.slice(2);
  lists.unshift({ kind: 'playlist', id: uploads, title: 'Uploads', channel: decode(c.snippet.title), thumb: c.snippet.thumbnails?.medium?.url ?? '', duration: 0 });
  return { channel: decode(c.snippet.title), lists };
}
