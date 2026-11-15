import type { Game } from '../../game';

// Taking pictures of the game and keeping them on the phone (IndexedDB), for photo mode, the album
// and postcards.

export interface PhotoMeta {
  /** Where it was taken (region name), and a line to show under it. */
  region?: string;
  caption?: string;
  /** 'photo' (photo mode) or 'postcard' (taken for you along the way). */
  kind?: string;
  car?: string;
}

export interface Photo {
  id: number;
  at: number;
  blob: Blob;
  thumb: Blob;
  meta: PhotoMeta;
}

export interface CaptureOptions {
  /** A CSS filter to bake in (picture styles on the simpler graphics levels). */
  filter?: string;
  /** Black bars top and bottom, as a fraction of the height each (0 = none). */
  bars?: number;
  /** A caption written along the bottom, with a smaller second line. */
  caption?: string;
  sub?: string;
  quality?: number;
}

/** How many photos the album keeps; the oldest go first. */
export const ALBUM_MAX = 60;

function toBlob(c: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not make the picture'))), 'image/jpeg', quality));
}

/** Width and height that fit inside `maxW` wide, keeping the shape. */
export function fit(w: number, h: number, maxW: number): [number, number] {
  const k = Math.min(1, maxW / Math.max(1, w));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Draw a caption strip along the bottom of a picture. */
function drawCaption(g: CanvasRenderingContext2D, w: number, h: number, caption: string, sub: string, lift: number) {
  const size = Math.round(Math.max(14, w * 0.026));
  const pad = Math.round(size * 0.9);
  const grad = g.createLinearGradient(0, h - lift - size * 4.2, 0, h - lift);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, h - lift - size * 4.2, w, size * 4.2);
  g.fillStyle = '#fff';
  g.textBaseline = 'alphabetic';
  g.font = `800 ${size}px Inter, system-ui, sans-serif`;
  g.fillText(caption, pad, h - lift - pad - (sub ? size * 0.95 : 0));
  if (sub) {
    g.globalAlpha = 0.8;
    g.font = `400 ${Math.round(size * 0.68)}px Inter, system-ui, sans-serif`;
    g.fillText(sub, pad, h - lift - pad);
    g.globalAlpha = 1;
  }
  g.textAlign = 'right';
  g.globalAlpha = 0.7;
  g.font = `600 ${Math.round(size * 0.62)}px Inter, system-ui, sans-serif`;
  g.fillText('Endless Drive', w - pad, h - lift - pad);
  g.globalAlpha = 1;
  g.textAlign = 'left';
}

/**
 * Take a picture of the next frame the game draws, scaled to at most `maxW` wide, as a JPEG.
 * (The game's canvas can only be read straight after it is drawn, hence game.snapshot.)
 */
export function capturePhoto(game: Game, maxW = 1280, opts: CaptureOptions = {}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    game.snapshot((src) => {
      try {
        const [w, h] = fit(src.width, src.height, maxW);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d')!;
        if (opts.filter) g.filter = opts.filter;
        g.drawImage(src, 0, 0, w, h);
        g.filter = 'none';
        const bar = Math.round(h * (opts.bars ?? 0));
        if (bar > 0) {
          g.fillStyle = '#000';
          g.fillRect(0, 0, w, bar);
          g.fillRect(0, h - bar, w, bar);
        }
        if (opts.caption) drawCaption(g, w, h, opts.caption, opts.sub ?? '', bar);
        toBlob(c, opts.quality ?? 0.88).then(resolve, reject);
      } catch (e) {
        reject(e as Error);
      }
    });
  });
}

/** A small copy of a picture for the album grid. */
async function thumbOf(blob: Blob, maxW = 360): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const [w, h] = fit(bmp.width, bmp.height, maxW);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return await toBlob(c, 0.8);
  } catch {
    return blob;
  }
}

// ---- The album (IndexedDB) ----

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const rq = indexedDB.open('endless-drive-photos', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error ?? new Error('No photo storage'));
    });
    dbp.catch(() => (dbp = null));
  }
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, run: (st: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((res, rej) => {
        const t = d.transaction('photos', mode);
        const rq = run(t.objectStore('photos'));
        t.oncomplete = () => res(rq.result);
        t.onerror = () => rej(t.error ?? new Error('Photo storage failed'));
        t.onabort = () => rej(t.error ?? new Error('Photo storage failed'));
      }),
  );
}

const changed: (() => void)[] = [];
/** Be told when the album changes. */
export function onAlbumChange(fn: () => void) {
  changed.push(fn);
}

/** The album, newest first. */
export async function listPhotos(): Promise<Photo[]> {
  const all = await tx<Photo[]>('readonly', (st) => st.getAll() as IDBRequest<Photo[]>);
  return all.sort((a, b) => b.at - a.at);
}

/** Put a picture in the album (dropping the oldest beyond ALBUM_MAX). Returns its id. */
export async function savePhoto(blob: Blob, meta: PhotoMeta = {}): Promise<number> {
  const thumb = await thumbOf(blob);
  const id = (await tx<IDBValidKey>('readwrite', (st) => st.add({ at: Date.now(), blob, thumb, meta }))) as number;
  const all = await listPhotos();
  for (const old of all.slice(ALBUM_MAX)) await tx('readwrite', (st) => st.delete(old.id));
  changed.forEach((f) => f());
  return id;
}

export async function deletePhoto(id: number): Promise<void> {
  await tx('readwrite', (st) => st.delete(id));
  changed.forEach((f) => f());
}

/** Share a picture (the phone's share sheet), or save it as a file where sharing isn't there. */
export async function sharePhoto(p: Photo): Promise<'shared' | 'saved' | 'cancelled'> {
  const name = `endless-drive-${new Date(p.at).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
  const file = new File([p.blob], name, { type: 'image/jpeg' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Endless Drive', text: p.meta.caption ?? p.meta.region ?? '' });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(p.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'saved';
}
