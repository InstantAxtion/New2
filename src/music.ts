import { VideoScreen } from './video';
import { cached, KeyError, QuotaError, remember, searchSong, type Candidate, type Prefer, type Song } from './youtube';

export interface NowPlaying {
  song: Song | null;
  /** The video playing (title and channel), if any. */
  video: { title: string; channel: string } | null;
  status: string;
  index: number;
}

/**
 * Plays a list of songs as music videos: finds a video for each song, plays it,
 * and moves on to the next one when it ends.
 */
export class MusicVideos {
  readonly screen = new VideoScreen();
  songs: Song[] = [];
  listName = '';
  index = -1;
  /** A YouTube playlist being played directly (no searching needed). */
  ytList: string | null = null;
  status = '';
  apiKey = '';
  prefer: Prefer = 'video';
  private cands: Candidate[] = [];
  private pick = 0;
  private custom: string | null = null;
  private token = 0;
  onChange: () => void = () => {};

  constructor() {
    this.screen.onEnded = () => this.ended();
    this.screen.onError = (code) => this.failed(code);
    this.screen.onPlaying = () => {
      this.status = '';
      this.onChange();
    };
  }

  get active() {
    return this.screen.active;
  }

  get song(): Song | null {
    return this.songs[this.index] ?? null;
  }

  get current(): Candidate | null {
    return this.custom ? null : this.cands[this.pick] ?? null;
  }

  now(): NowPlaying {
    let video: NowPlaying['video'] = null;
    const c = this.current;
    if (c) video = { title: c.title, channel: c.channel };
    else {
      const i = this.screen.info();
      if (i) video = { title: i.title, channel: i.author };
    }
    return { song: this.song, video, status: this.status, index: this.index };
  }

  setSongs(name: string, songs: Song[]) {
    this.ytList = null;
    this.listName = name;
    this.songs = songs;
    this.index = -1;
  }

  /** Play a YouTube video or playlist link directly. */
  playYouTube(link: { videoId?: string; listId?: string }) {
    this.songs = [];
    this.index = -1;
    this.cands = [];
    this.custom = link.videoId ?? null;
    this.ytList = link.listId ?? null;
    this.status = 'Loading…';
    this.onChange();
    if (link.listId) void this.screen.playList(link.listId);
    else if (link.videoId) void this.screen.play(link.videoId);
  }

  async playIndex(i: number) {
    if (!this.songs.length) return;
    this.index = ((i % this.songs.length) + this.songs.length) % this.songs.length;
    const song = this.songs[this.index];
    const t = ++this.token;
    this.cands = [];
    this.pick = 0;
    this.custom = null;
    const hit = cached(song, this.prefer);
    if (hit) {
      this.cands = hit.cands;
      this.pick = hit.pick;
      this.custom = hit.custom ?? null;
    } else if (this.apiKey) {
      this.status = 'Finding the video…';
      this.onChange();
      try {
        this.cands = await searchSong(song, this.apiKey, this.prefer);
      } catch (e) {
        if (t !== this.token) return;
        this.status =
          e instanceof QuotaError ? 'YouTube search limit reached for today — paste a link, or try tomorrow.'
          : e instanceof KeyError ? 'Your YouTube API key was rejected. Check it in Settings.'
          : "Couldn't reach YouTube.";
        this.onChange();
        return;
      }
      if (t !== this.token) return;
      remember(song, this.prefer, { cands: this.cands, pick: 0 });
    } else {
      this.status = 'Add a YouTube API key in Settings to find videos, or paste a YouTube link for this song.';
      this.screen.stop();
      this.onChange();
      return;
    }
    if (t !== this.token) return;
    this.start();
  }

  private start() {
    const id = this.custom ?? this.cands[this.pick]?.id;
    if (!id) {
      this.status = 'No video found for this song.';
      this.onChange();
      window.setTimeout(() => this.status === 'No video found for this song.' && this.next(), 2500);
      return;
    }
    this.status = 'Loading…';
    this.onChange();
    void this.screen.play(id);
  }

  /** The video wouldn't play (e.g. embedding disabled): try the next best one. */
  private failed(code: number) {
    if (this.ytList) {
      this.screen.next();
      return;
    }
    if (!this.custom && this.pick + 1 < this.cands.length) {
      this.pick++;
      this.status = code === 101 || code === 150 ? 'That video only plays on YouTube, trying another…' : 'Trying another video…';
      this.onChange();
      this.start();
      return;
    }
    this.status = "This song's video won't play here. Skipping…";
    this.onChange();
    window.setTimeout(() => this.next(), 1500);
  }

  /** Swap to the next-best video for this song (and remember the choice). */
  otherVideo() {
    const song = this.song;
    if (!song || !this.cands.length) return;
    this.custom = null;
    this.pick = (this.pick + 1) % this.cands.length;
    remember(song, this.prefer, { cands: this.cands, pick: this.pick });
    this.start();
  }

  /** Use the player's own YouTube link for this song from now on. */
  useLink(videoId: string) {
    const song = this.song;
    this.custom = videoId;
    if (song) remember(song, this.prefer, { cands: this.cands, pick: this.pick, custom: videoId });
    this.start();
  }

  /** Play the songs in a random order. */
  shuffle = false;
  /** Repeat nothing, the whole list, or this song. */
  repeat: 'off' | 'all' | 'one' = 'all';

  /** A video finished: what plays next depends on shuffle and repeat. */
  private ended() {
    if (this.repeat === 'one' && this.songs.length && !this.ytList) return void this.playIndex(this.index);
    if (!this.shuffle && this.repeat === 'off' && !this.ytList && this.index >= this.songs.length - 1) {
      this.status = 'End of the playlist';
      this.onChange();
      return;
    }
    this.next();
  }

  next() {
    if (this.ytList) return this.screen.next();
    if (!this.songs.length) return;
    if (this.shuffle && this.songs.length > 1) {
      let i = this.index;
      while (i === this.index) i = Math.floor(Math.random() * this.songs.length);
      void this.playIndex(i);
    } else void this.playIndex(this.index + 1);
  }

  previous() {
    if (this.ytList) return this.screen.previous();
    if (this.songs.length) void this.playIndex(this.index - 1);
  }

  toggle() {
    this.screen.toggle();
    this.onChange();
  }

  stop() {
    this.token++;
    this.screen.stop();
    this.status = '';
    this.onChange();
  }
}
