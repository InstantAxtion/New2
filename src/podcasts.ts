import { CapacitorHttp, Capacitor } from '@capacitor/core';
import { openTrack, type Track } from './bgaudio';

// Podcasts: search the Apple Podcasts directory, read the show's RSS feed, and play episodes.

export interface Show {
  id: number;
  name: string;
  author: string;
  art: string;
  feed: string;
}

export interface Episode {
  title: string;
  url: string;
  date: string;
  /** Seconds, 0 if unknown. */
  duration: number;
}

async function getText(url: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, responseType: 'text' });
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

export async function searchShows(term: string): Promise<Show[]> {
  const q = new URLSearchParams({ media: 'podcast', entity: 'podcast', limit: '20', term });
  const data = JSON.parse(await getText(`https://itunes.apple.com/search?${q}`)) as {
    results: { collectionId: number; collectionName: string; artistName: string; artworkUrl100: string; feedUrl?: string }[];
  };
  return data.results
    .filter((r) => r.feedUrl)
    .map((r) => ({ id: r.collectionId, name: r.collectionName, author: r.artistName, art: r.artworkUrl100, feed: r.feedUrl! }));
}

/** "01:02:03", "62:03" or seconds, to seconds. */
export function parseDuration(s: string | null | undefined): number {
  if (!s) return 0;
  const parts = s.trim().split(':').map(Number);
  if (parts.some((n) => isNaN(n))) return 0;
  return parts.reduce((t, n) => t * 60 + n, 0);
}

const decode = (t: string) =>
  t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();

/** Episodes from a podcast's RSS feed (newest first, as the feed lists them). */
export function parseFeed(xml: string): Episode[] {
  const out: Episode[] = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) ?? [];
  for (const item of items.slice(0, 50)) {
    const url = item.match(/<enclosure[^>]*\burl=["']([^"']+)["']/)?.[1];
    if (!url) continue;
    const tag = (name: string) => item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1];
    const pub = tag('pubDate');
    const d = pub ? new Date(decode(pub)) : null;
    out.push({
      title: decode(tag('title') ?? 'Episode'),
      url: decode(url).replace(/^http:/, 'https:'),
      date: d && !isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '',
      duration: parseDuration(tag('itunes:duration')),
    });
  }
  return out;
}

export async function loadEpisodes(show: Show): Promise<Episode[]> {
  if (show.feed.startsWith('archive:')) return loadChapters(show);
  return parseFeed(await getText(show.feed));
}

export class PodcastPlayer {
  private audio: Track | null = null;
  show: Show | null = null;
  episode: Episode | null = null;
  playing = false;
  error = '';
  rate = 1;
  private vol = 1;
  onChange: () => void = () => {};

  /** The rest of the list (chapters of a book play on one after another). */
  private queue: Episode[] = [];

  play(show: Show, ep: Episode, list: Episode[] = []) {
    this.stop();
    this.queue = list;
    const a = openTrack(ep.url, { title: ep.title, subtitle: `🎙️ ${show.name}`, live: false });
    a.volume = this.vol;
    a.playbackRate = this.rate;
    a.onplaying = () => {
      this.playing = true;
      this.error = '';
      this.onChange();
    };
    a.onpause = () => {
      this.playing = false;
      this.onChange();
    };
    a.onerror = () => {
      this.playing = false;
      this.error = "Couldn't play this episode.";
      this.onChange();
    };
    a.ontimeupdate = () => this.onChange();
    a.onended = () => {
      // Audiobooks carry on with the next chapter
      if (!show.feed.startsWith('archive:')) return;
      const i = this.queue.indexOf(ep);
      if (i >= 0 && i + 1 < this.queue.length) this.play(show, this.queue[i + 1], this.queue);
    };
    this.audio = a;
    this.show = show;
    this.episode = ep;
    void a.play().catch(() => {
      this.error = 'Tap play to start.';
      this.onChange();
    });
  }

  toggle() {
    const a = this.audio;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  skip(sec: number) {
    if (this.audio) this.audio.currentTime = Math.max(0, this.audio.currentTime + sec);
  }

  setRate(r: number) {
    this.rate = r;
    if (this.audio) this.audio.playbackRate = r;
  }

  setVolume(v: number) {
    this.vol = v;
    if (this.audio) this.audio.volume = v;
  }

  get time(): { t: number; d: number } {
    return { t: this.audio?.currentTime ?? 0, d: this.audio?.duration || this.episode?.duration || 0 };
  }

  stop() {
    if (this.audio) this.audio.stop();
    this.audio = null;
    this.playing = false;
    this.onChange();
  }
}

// ---- Audiobooks: free public-domain recordings from LibriVox (hosted on archive.org) ----

/** A LibriVox audiobook, as a "show" whose chapters are its episodes. */
export async function searchBooks(term: string): Promise<Show[]> {
  const words = term.trim().replace(/[()":]/g, ' ');
  const q = `collection:librivoxaudio AND (title:(${words}) OR creator:(${words}))`;
  const p = new URLSearchParams({ q, rows: '25', output: 'json', 'sort[]': 'downloads desc' });
  for (const f of ['identifier', 'title', 'creator']) p.append('fl[]', f);
  const data = JSON.parse(await getText(`https://archive.org/advancedsearch.php?${p}`)) as {
    response: { docs: { identifier: string; title: string; creator?: string | string[] }[] };
  };
  return data.response.docs.map((d, i) => ({
    id: i,
    name: d.title.replace(/\s*\(version \d+\)/i, '').trim(),
    author: Array.isArray(d.creator) ? d.creator.join(', ') : d.creator ?? 'LibriVox',
    art: `https://archive.org/services/img/${d.identifier}`,
    feed: `archive:${d.identifier}`,
  }));
}

/** A book's chapters (the 64 kbps MP3 of each section, in order). */
export async function loadChapters(show: Show): Promise<Episode[]> {
  const id = show.feed.replace(/^archive:/, '');
  const data = JSON.parse(await getText(`https://archive.org/metadata/${id}`)) as {
    files: { name: string; format?: string; title?: string; track?: string; length?: string }[];
  };
  return data.files
    .filter((f) => f.format === '64Kbps MP3')
    .sort((a, b) => Number(a.track ?? 0) - Number(b.track ?? 0) || a.name.localeCompare(b.name))
    .map((f) => ({
      title: f.title || f.name.replace(/_64kb\.mp3$/, ''),
      url: `https://archive.org/download/${id}/${encodeURIComponent(f.name)}`,
      date: '',
      duration: parseDuration(f.length),
    }));
}
