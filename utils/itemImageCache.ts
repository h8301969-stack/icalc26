/**
 * Durable on-device cache for inventory photos.
 * Bytes live here first (offline), then Supabase, then Telegram.
 * Inventory rows store short refs only (`itemimg:` / `tgfile:` / http).
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';

const DB_NAME = 'icalc-item-images';
const DB_VERSION = 1;
const STORE = 'blobs';
/** Cap cached photos so IndexedDB stays bounded. */
const MAX_ENTRIES = 250;
const PHONE_DIR = 'item-images';

interface CacheRow {
  fileId: string;
  blob: Blob;
  updatedAt: number;
}

const memoryUrls = new Map<string, string>();

export const itemCacheKey = (itemId: string): string => `item:${itemId.trim()}`;

export const peekCachedItemImageUrl = (key: string): string | null => {
  const id = key.trim();
  return id ? memoryUrls.get(id) ?? null : null;
};

export const rememberItemImageUrl = (key: string, url: string): void => {
  const id = key.trim();
  if (!id || !url) return;
  memoryUrls.set(id, url);
};

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
  for (const row of drop) {
    store.delete(row.fileId);
    memoryUrls.delete(row.fileId);
    void deletePhoneFile(row.fileId);
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('evict failed'));
  });
};

const safeFsName = (key: string): string => key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);

const phonePath = (key: string): string => `${PHONE_DIR}/${safeFsName(key)}.bin`;

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const s = String(reader.result || '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });

const base64ToBlob = (b64: string, type: string): Blob | null => {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: type || 'image/jpeg' });
  } catch {
    return null;
  }
};

const writePhoneFile = async (key: string, blob: Blob): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const data = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: phonePath(key),
      data,
      directory: Directory.Data,
      recursive: true,
    });
  } catch {
    // Phone storage is best-effort.
  }
};

const readPhoneFile = async (key: string): Promise<Blob | null> => {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const result = await Filesystem.readFile({
      path: phonePath(key),
      directory: Directory.Data,
    });
    if (typeof result.data !== 'string' || !result.data) return null;
    return base64ToBlob(result.data, 'image/jpeg');
  } catch {
    return null;
  }
};

const deletePhoneFile = async (key: string): Promise<void> => {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Filesystem.deleteFile({
      path: phonePath(key),
      directory: Directory.Data,
    });
  } catch {
    /* ignore */
  }
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
    // IndexedDB is best-effort — phone file + remotes still hold bytes.
  }
  void writePhoneFile(id, blob);
}

export async function readCachedItemImageBlob(fileId: string): Promise<Blob | null> {
  const id = fileId.trim();
  if (!id) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const row = (await idbReq(tx.objectStore(STORE).get(id))) as CacheRow | undefined;
    db.close();
    if (row?.blob) return row.blob;
  } catch {
    /* fall through to phone storage */
  }
  const phone = await readPhoneFile(id);
  if (phone) {
    void cacheItemImageBlob(id, phone);
    return phone;
  }
  return null;
}

export async function readCachedItemImageUrl(fileId: string): Promise<string | null> {
  const id = fileId.trim();
  if (!id) return null;
  const mem = memoryUrls.get(id);
  if (mem) {
    void readCachedItemImageBlob(id).then((blob) => {
      if (blob) void cacheItemImageBlob(id, blob);
    });
    return mem;
  }
  const blob = await readCachedItemImageBlob(id);
  if (!blob) return null;
  void cacheItemImageBlob(id, blob);
  const url = URL.createObjectURL(blob);
  rememberItemImageUrl(id, url);
  return url;
}

/** Cache bytes under the stable item id (offline display does not wait on Telegram). */
export async function cacheItemImageForItem(itemId: string, blob: Blob): Promise<string | null> {
  const id = itemId.trim();
  if (!id || !blob || blob.size <= 0) return null;
  const key = itemCacheKey(id);
  const url = URL.createObjectURL(blob);
  rememberItemImageUrl(key, url);
  await cacheItemImageBlob(key, blob);
  return url;
}

export async function readCachedItemImageForItem(itemId: string): Promise<string | null> {
  const id = itemId.trim();
  if (!id) return null;
  return readCachedItemImageUrl(itemCacheKey(id));
}

export async function readCachedItemImageBlobForItem(itemId: string): Promise<Blob | null> {
  const id = itemId.trim();
  if (!id) return null;
  return readCachedItemImageBlob(itemCacheKey(id));
}
