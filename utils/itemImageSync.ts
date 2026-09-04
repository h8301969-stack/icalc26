/**
 * Inventory photo sequence (do not skip steps):
 * 1. Phone / local cache — show immediately, work offline
 * 2. Supabase Storage — restore on login for a new device
 * 3. Telegram sendPhoto — permanent archive, retrievable via `tgfile:`
 */

import { useEffect, useRef } from 'react';
import { storage } from '../hooks/storage';
import { isCloudBackendEnabled, supabase } from './supabase';
import {
  cacheItemImageBlob,
  cacheItemImageForItem,
  itemCacheKey,
  peekCachedItemImageUrl,
  readCachedItemImageBlobForItem,
  readCachedItemImageForItem,
  readCachedItemImageUrl,
  rememberItemImageUrl,
} from './itemImageCache';
import {
  encodeTelegramItemImageRef,
  isTelegramItemImageRef,
  parseTelegramItemImageRef,
  telegramResolveItemImageUrl,
  telegramUploadItemImage,
} from './telegramDb';

export const ITEM_IMAGE_PREFIX = 'itemimg:';
export const ITEM_IMAGES_BUCKET = 'item-images';
const REMOTE_QUEUE_KEY = 'pos_inventory_image_remote_queue';

type RemoteQueue = Record<string, { supabase?: boolean; telegram?: boolean }>;

export const isItemImageRef = (value: string | null | undefined): boolean =>
  !!value && value.startsWith(ITEM_IMAGE_PREFIX);

export const encodeItemImageRef = (itemId: string): string =>
  `${ITEM_IMAGE_PREFIX}${itemId.trim()}`;

export const parseItemImageRef = (value: string | null | undefined): string | null => {
  if (!isItemImageRef(value)) return null;
  const id = value!.slice(ITEM_IMAGE_PREFIX.length).trim();
  return id || null;
};

export const isDurableItemImageRef = (value: string | null | undefined): boolean => {
  const v = (value || '').trim();
  if (!v) return false;
  return isItemImageRef(v) || isTelegramItemImageRef(v) || /^https?:\/\//i.test(v);
};

const dataUrlToBlob = async (dataUrl: string): Promise<Blob | null> => {
  try {
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch {
    return null;
  }
};

const toBlob = async (image: string | Blob): Promise<Blob | null> => {
  if (typeof image !== 'string') return image.size > 0 ? image : null;
  if (/^data:image\//i.test(image) || /^blob:/i.test(image)) {
    return dataUrlToBlob(image);
  }
  return null;
};

const readQueue = (): RemoteQueue => storage.get<RemoteQueue>(REMOTE_QUEUE_KEY, {});

const writeQueue = (queue: RemoteQueue): void => {
  storage.set(REMOTE_QUEUE_KEY, queue);
};

const markRemotePending = (itemId: string, flags: { supabase?: boolean; telegram?: boolean }): void => {
  const id = itemId.trim();
  if (!id) return;
  const queue = readQueue();
  const prev = queue[id] ?? {};
  queue[id] = { ...prev, ...flags };
  if (!queue[id].supabase && !queue[id].telegram) delete queue[id];
  writeQueue(queue);
};

const supabaseObjectPath = (accountId: string, itemId: string): string =>
  `${accountId.trim()}/${itemId.trim()}.jpg`;

async function uploadItemImageToSupabase(
  accountId: string,
  itemId: string,
  blob: Blob
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isCloudBackendEnabled()) {
    return { ok: false, error: 'Supabase is not configured.' };
  }
  const path = supabaseObjectPath(accountId, itemId);
  const { error } = await supabase.storage.from(ITEM_IMAGES_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: blob.type || 'image/jpeg',
    cacheControl: '3600',
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function downloadItemImageFromSupabase(
  accountId: string,
  itemId: string
): Promise<Blob | null> {
  if (!isCloudBackendEnabled() || !accountId.trim() || !itemId.trim()) return null;
  try {
    const { data, error } = await supabase.storage
      .from(ITEM_IMAGES_BUCKET)
      .download(supabaseObjectPath(accountId, itemId));
    if (error || !data || data.size <= 0) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Push cached bytes to Supabase + Telegram. Local cache is already the display source.
 */
export async function syncItemImageRemotes(input: {
  accountId: string | null | undefined;
  itemId: string;
  blob: Blob;
  itemName?: string;
  onDurableRef?: (imageRef: string) => void;
}): Promise<void> {
  const itemId = input.itemId.trim();
  const accountId = input.accountId?.trim() || '';
  if (!itemId || !input.blob || input.blob.size <= 0) return;

  markRemotePending(itemId, { supabase: true, telegram: true });

  if (accountId && isCloudBackendEnabled()) {
    const uploaded = await uploadItemImageToSupabase(accountId, itemId, input.blob);
    if (uploaded.ok) {
      markRemotePending(itemId, { supabase: false });
      const { error: rowError } = await supabase
        .from('inventory_items')
        .update({ image_url: encodeItemImageRef(itemId) })
        .eq('id', itemId)
        .eq('user_id', accountId);
      if (rowError) {
        console.warn('[iCalc] item image_url stamp failed', itemId, rowError.message);
      }
    } else {
      console.warn('[iCalc] item image Supabase upload failed', itemId, uploaded.error);
    }
  }

  if (accountId) {
    const uploaded = await telegramUploadItemImage({
      accountId,
      itemId,
      image: input.blob,
      itemName: input.itemName,
    });
    if (uploaded.ok) {
      markRemotePending(itemId, { telegram: false });
      void cacheItemImageBlob(uploaded.fileId, input.blob);
      const localUrl = peekCachedItemImageUrl(itemCacheKey(itemId));
      if (localUrl) rememberItemImageUrl(uploaded.fileId, localUrl);
      input.onDurableRef?.(uploaded.imageRef);
    } else {
      console.warn('[iCalc] item image Telegram upload failed', itemId, uploaded.error);
    }
  }
}

/**
 * Step 1 of the sequence: cache on the phone, return `itemimg:` immediately.
 * Steps 2–3 run in the background.
 */
export async function persistItemImage(input: {
  accountId?: string | null;
  itemId: string;
  image: string | Blob;
  itemName?: string;
  onDurableRef?: (imageRef: string) => void;
}): Promise<{ ok: true; imageRef: string } | { ok: false; error: string }> {
  const itemId = input.itemId.trim();
  if (!itemId) return { ok: false, error: 'Missing item id.' };

  const blob = await toBlob(input.image);
  if (!blob) return { ok: false, error: 'Could not read item image.' };

  const localUrl = await cacheItemImageForItem(itemId, blob);
  if (!localUrl) return { ok: false, error: 'Could not cache item image on this device.' };

  const imageRef = encodeItemImageRef(itemId);
  void syncItemImageRemotes({
    accountId: input.accountId,
    itemId,
    blob,
    itemName: input.itemName,
    onDurableRef: input.onDurableRef,
  });
  return { ok: true, imageRef };
}

/** Display resolve: memory/IDB/phone → Supabase → Telegram. */
export async function resolveItemImageUrl(
  accountId: string | null | undefined,
  imageRef: string | null | undefined,
  itemId?: string | null
): Promise<string | null> {
  const resolvedItemId = parseItemImageRef(imageRef) || itemId?.trim() || null;
  const fileId = parseTelegramItemImageRef(imageRef);
  const raw = (imageRef || '').trim();

  if (/^data:image\//i.test(raw) || /^blob:/i.test(raw) || /^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (resolvedItemId) {
    const local = await readCachedItemImageForItem(resolvedItemId);
    if (local) return local;
  }
  if (fileId) {
    const local = await readCachedItemImageUrl(fileId);
    if (local) return local;
  }

  if (accountId && resolvedItemId) {
    const remote = await downloadItemImageFromSupabase(accountId, resolvedItemId);
    if (remote) {
      const url = await cacheItemImageForItem(resolvedItemId, remote);
      if (fileId) {
        void cacheItemImageBlob(fileId, remote);
        if (url) rememberItemImageUrl(fileId, url);
      }
      if (url) return url;
    }
  }

  if (fileId) {
    return telegramResolveItemImageUrl(accountId, encodeTelegramItemImageRef(fileId));
  }

  return null;
}

export async function flushItemImageRemoteQueue(
  accountId: string,
  items: Array<{ id: string; name?: string }>
): Promise<void> {
  if (!accountId.trim()) return;
  const queue = readQueue();
  const names = new Map(items.map((item) => [item.id, item.name]));
  for (const [itemId, flags] of Object.entries(queue)) {
    if (!flags?.supabase && !flags?.telegram) continue;
    const blob = await readCachedItemImageBlobForItem(itemId);
    if (!blob) continue;
    if (flags.supabase && isCloudBackendEnabled()) {
      const uploaded = await uploadItemImageToSupabase(accountId, itemId, blob);
      if (uploaded.ok) markRemotePending(itemId, { supabase: false });
    }
    if (flags.telegram) {
      const uploaded = await telegramUploadItemImage({
        accountId,
        itemId,
        image: blob,
        itemName: names.get(itemId),
      });
      if (uploaded.ok) {
        markRemotePending(itemId, { telegram: false });
        void cacheItemImageBlob(uploaded.fileId, blob);
      }
    }
  }
}

export async function hydrateItemImagesForAccount(
  accountId: string,
  items: Array<{ id: string; image?: string | null; name?: string }>
): Promise<void> {
  if (!accountId || !items.length) return;
  void flushItemImageRemoteQueue(accountId, items);

  const jobs = items.filter((item) => isDurableItemImageRef(item.image));
  let cursor = 0;
  const limit = Math.min(6, jobs.length);
  const worker = async () => {
    while (cursor < jobs.length) {
      const current = cursor;
      cursor += 1;
      const item = jobs[current];
      await resolveItemImageUrl(accountId, item.image, item.id);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
}

/** Warm local + remote image cache after login / inventory changes. */
export function useItemImageHydrate(
  accountId: string | null | undefined,
  items: Array<{ id: string; image?: string | null; name?: string }>
): void {
  const sigRef = useRef('');
  useEffect(() => {
    if (!accountId || items.length === 0) return;
    const sig = `${accountId}:${items.map((item) => `${item.id}:${item.image ?? ''}`).join('|')}`;
    if (sigRef.current === sig) return;
    sigRef.current = sig;
    void hydrateItemImagesForAccount(accountId, items);
  }, [accountId, items]);
}
