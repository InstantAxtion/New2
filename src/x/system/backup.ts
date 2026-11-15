// Backup and restore: everything the game keeps on the phone, as one piece of text.

export const BACKUP_KEYS = ['endless-drive.settings', 'endless-drive.stats'] as const;
const PREFIX = 'ED1:';

export interface Backup {
  app: 'endless-drive';
  v: 1;
  at: number;
  data: Record<string, unknown>;
}

function toB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(s: string): string {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Pack saved data into a backup code. */
export function makeBackup(read: (key: string) => string | null, now = Date.now()): string {
  const data: Record<string, unknown> = {};
  for (const k of BACKUP_KEYS) {
    const raw = read(k);
    if (!raw) continue;
    try { data[k] = JSON.parse(raw); } catch { /* skip anything unreadable */ }
  }
  const b: Backup = { app: 'endless-drive', v: 1, at: now, data };
  return PREFIX + toB64(JSON.stringify(b));
}

/** Read a backup code (or the plain JSON inside one). Throws a friendly message if it isn't one. */
export function readBackup(text: string): Backup {
  let t = text.trim();
  if (!t) throw new Error('Nothing to restore: paste a backup code first.');
  try {
    if (t.startsWith(PREFIX)) t = fromB64(t.slice(PREFIX.length).replace(/\s+/g, ''));
  } catch {
    throw new Error('That code is damaged or incomplete.');
  }
  let b: Backup;
  try {
    b = JSON.parse(t) as Backup;
  } catch {
    throw new Error('That doesn\'t look like an Endless Drive backup.');
  }
  if (!b || b.app !== 'endless-drive' || typeof b.data !== 'object' || b.data === null) throw new Error('That doesn\'t look like an Endless Drive backup.');
  if (b.v !== 1) throw new Error('This backup is from a newer version of the game.');
  const data: Record<string, unknown> = {};
  for (const k of BACKUP_KEYS) {
    const v = b.data[k];
    if (v === undefined) continue;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('That backup is damaged.');
    data[k] = v;
  }
  if (!Object.keys(data).length) throw new Error('That backup is empty.');
  return { app: 'endless-drive', v: 1, at: Number(b.at) || 0, data };
}

/** Put a backup's data back. */
export function applyBackup(b: Backup, write: (key: string, value: string) => void) {
  for (const [k, v] of Object.entries(b.data)) write(k, JSON.stringify(v));
}
