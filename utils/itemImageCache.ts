/**
 * Small durable offline cache for Telegram-backed inventory photos.
 * Inventory rows store only `tgfile:<file_id>`; bytes live on Telegram + this cache.
 */

const DB_NAME = 'icalc-item-images';
const DB_VERSION = 1;
const STORE = 'blobs';
/** Cap cached photos so local storage stays small. */
const MAX_ENTRIES = 80;

interface CacheRow {
  fileId: string;
  blob: Blob;
  updatedAt: number;
}

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'fileId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });

const idbReq = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });

const evictIfNeeded = async (db: IDBDatabase): Promise<void> => {
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const all = (await idbReq(store.getAll())) as CacheRow[];
  if (all.length <= MAX_ENTRIES) return;
  const sorted = [...all].sort((a, b) => a.updatedAt - b.updatedAt);
  const drop = sorted.slice(0, all.length - MAX_ENTRIES);
  for (const row of drop) store.delete(row.fileId);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('evict failed'));
  });
};

export async function cacheItemImageBlob(fileId: string, blob: Blob): Promise<void> {
  const id = fileId.trim();
  if (!id || !blob || blob.size <= 0) return;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ fileId: id, blob, updatedAt: Date.now() } satisfies CacheRow);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('cache put failed'));
    });
    await evictIfNeeded(db);
    db.close();
  } catch {
    // Cache is best-effort — Telegram remains source of truth.
  }
}

export async function readCachedItemImageBlob(fileId: string): Promise<Blob | null> {
  const id = fileId.trim();
  if (!id) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const row = (await idbReq(tx.objectStore(STORE).get(id))) as CacheRow | undefined;
    db.close();
    return row?.blob ?? null;
  } catch {
    return null;
  }
}

export async function readCachedItemImageUrl(fileId: string): Promise<string | null> {
  const blob = await readCachedItemImageBlob(fileId);
  if (!blob) return null;
  // Refresh LRU timestamp
  void cacheItemImageBlob(fileId, blob);
  return URL.createObjectURL(blob);
}
