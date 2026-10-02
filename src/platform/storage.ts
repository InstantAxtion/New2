// Save games in IndexedDB (falls back to localStorage), plus small preferences.
const DB = 'sovereign-saves';
const STORE = 'saves';

export interface SaveMeta {
  slot: string;
  nation: string;
  scenario: string;
  date: string;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (!('indexedDB' in globalThis)) return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function writeSave(meta: SaveMeta, json: string) {
  const ok = await tx('readwrite', (s) => s.put({ meta, json }, meta.slot));
  if (ok === null) {
    try {
      localStorage.setItem('save:' + meta.slot, JSON.stringify({ meta, json }));
    } catch {
      /* storage full or unavailable */
    }
  }
}

export async function readSave(slot: string): Promise<{ meta: SaveMeta; json: string } | null> {
  const r = await tx<{ meta: SaveMeta; json: string }>('readonly', (s) => s.get(slot));
  if (r) return r;
  try {
    const v = localStorage.getItem('save:' + slot);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export async function listSaves(): Promise<SaveMeta[]> {
  const all = await tx<{ meta: SaveMeta }[]>('readonly', (s) => s.getAll() as IDBRequest<{ meta: SaveMeta }[]>);
  const metas = (all || []).map((x) => x.meta);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith('save:') && !metas.some((m) => 'save:' + m.slot === k)) metas.push(JSON.parse(localStorage.getItem(k)!).meta);
    }
  } catch {
    /* ignore */
  }
  return metas.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteSave(slot: string) {
  await tx('readwrite', (s) => s.delete(slot));
  try {
    localStorage.removeItem('save:' + slot);
  } catch {
    /* ignore */
  }
}

export function pref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem('pref:' + key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
export function setPref(key: string, v: unknown) {
  try {
    localStorage.setItem('pref:' + key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
