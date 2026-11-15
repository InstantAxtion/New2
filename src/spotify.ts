// Spotify: paste a share link (or a spotify: URI) and play it through Spotify's own
// embedded player, or hand it to the Spotify app for full-length playback.

export type SpotifyKind = 'playlist' | 'album' | 'track' | 'artist' | 'show' | 'episode';
const KINDS: SpotifyKind[] = ['playlist', 'album', 'track', 'artist', 'show', 'episode'];

export interface SpotifyRef {
  kind: SpotifyKind;
  id: string;
}

export type ParseResult = { ok: true; ref: SpotifyRef } | { ok: false; error: string };

const ID = /^[A-Za-z0-9]{22}$/;

export function parseSpotify(input: string): ParseResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Paste a Spotify link first.' };

  // Pull the first URL or URI out of pasted share text ("Check out this playlist https://...")
  const found = text.match(/(spotify:[a-z]+:[A-Za-z0-9]+)|(https?:\/\/[^\s]+)/i);
  const s = found ? found[0] : text;

  const uri = s.match(/^spotify:([a-z]+):([A-Za-z0-9]+)$/i);
  if (uri) return make(uri[1].toLowerCase(), uri[2]);

  if (/^https?:\/\/(spotify\.link|spotify\.app\.link)\//i.test(s)) {
    return {
      ok: false,
      error: 'That is a short share link. In Spotify tap Share → Copy link, open it in a browser, and paste the open.spotify.com address instead.',
    };
  }

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    if (ID.test(s)) return make('playlist', s);
    return { ok: false, error: "That doesn't look like a Spotify link." };
  }
  if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return { ok: false, error: "That doesn't look like a Spotify link." };
  // /intl-de/playlist/ID, /embed/playlist/ID, /user/x/playlist/ID
  const parts = url.pathname.split('/').filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i].toLowerCase();
    if ((KINDS as string[]).includes(k)) return make(k, parts[i + 1]);
  }
  return { ok: false, error: 'Paste a link to a playlist, album, track, artist or podcast.' };
}

function make(kind: string, id: string): ParseResult {
  if (!(KINDS as string[]).includes(kind)) return { ok: false, error: `Spotify ${kind} links aren't supported.` };
  if (!ID.test(id)) return { ok: false, error: 'That Spotify link looks incomplete.' };
  return { ok: true, ref: { kind: kind as SpotifyKind, id } };
}

export const embedUrl = (r: SpotifyRef) => `https://open.spotify.com/embed/${r.kind}/${r.id}?utm_source=generator&theme=0`;
export const webUrl = (r: SpotifyRef) => `https://open.spotify.com/${r.kind}/${r.id}`;
export const appUri = (r: SpotifyRef) => `spotify:${r.kind}:${r.id}`;

export interface SavedList {
  ref: SpotifyRef;
  name: string;
}

const KEY = 'endless-drive.spotify';

export function loadSaved(): SavedList[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && x.ref && ID.test(x.ref.id)) : [];
  } catch {
    return [];
  }
}

export function saveList(list: SavedList[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 12)));
  } catch {
    /* storage full or blocked */
  }
}

/** Look up a playlist's title through Spotify's public oEmbed endpoint (best effort). */
export async function fetchTitle(r: SpotifyRef): Promise<string | null> {
  try {
    const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(webUrl(r))}`);
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j.title === 'string' ? j.title : null;
  } catch {
    return null;
  }
}
