import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { SpotifyRef } from './spotify';
import type { Song } from './youtube';

/** GET a page as text: natively on the phone (no browser CORS limits), or via the dev server's proxy. */
async function getText(url: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, responseType: 'text' });
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  }
  const proxied = import.meta.env.DEV ? url.replace('https://open.spotify.com', '/proxy/spotify') : url;
  const r = await fetch(proxied);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

interface RawTrack {
  title?: string;
  name?: string;
  subtitle?: string;
  artists?: { name: string }[];
  duration?: number;
  uri?: string;
}

/** Pull the songs out of a Spotify embed page's data. */
export function parseEmbedPage(html: string): { name: string; songs: Song[] } {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No track data on the page');
  const data = JSON.parse(m[1]);
  const entity = data?.props?.pageProps?.state?.data?.entity;
  if (!entity) throw new Error('No track data on the page');
  const toSong = (t: RawTrack): Song => ({
    title: t.title ?? t.name ?? '',
    artist: t.subtitle ?? (t.artists ?? []).map((a) => a.name).join(', '),
    duration: t.duration ?? 0,
    uri: t.uri,
  });
  const list: RawTrack[] = Array.isArray(entity.trackList) ? entity.trackList : [entity];
  return {
    name: entity.title ?? entity.name ?? 'Spotify',
    songs: list.map(toSong).filter((s) => s.title),
  };
}

/** The songs in a Spotify playlist, album or track. */
export async function fetchSongs(ref: SpotifyRef): Promise<{ name: string; songs: Song[] }> {
  if (ref.kind !== 'playlist' && ref.kind !== 'album' && ref.kind !== 'track') {
    throw new Error('Music videos work with playlists, albums and songs.');
  }
  const html = await getText(`https://open.spotify.com/embed/${ref.kind}/${ref.id}`);
  return parseEmbedPage(html);
}
