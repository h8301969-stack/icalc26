/**
 * Profile avatars and wallpapers: local cache → Supabase Storage (cross-device).
 */

import { isCloudBackendEnabled, supabase } from './supabase';
import {
  cacheItemImageBlob,
  cacheItemImageForItem,
  peekCachedItemImageUrl,
  readCachedItemImageUrl,
} from './itemImageCache';
import type { WallpaperSlide } from './wallpapers';
import { resolveWallpaperImage } from './wallpapers';

export const AVATAR_PREFIX = 'avatar:';
export const WALL_PREFIX = 'wall:';
const AVATAR_BUCKET = 'profile-avatars';
const WALL_BUCKET = 'wallpapers';

export const isAvatarRef = (value: string | null | undefined): boolean =>
  !!value && value.startsWith(AVATAR_PREFIX);

export const isWallpaperRef = (value: string | null | undefined): boolean =>
  !!value && value.startsWith(WALL_PREFIX);

export const encodeAvatarRef = (profileId: string): string =>
  `${AVATAR_PREFIX}${profileId.trim()}`;

export const encodeWallpaperRef = (index: number): string => `${WALL_PREFIX}${index}`;

const sessionUserId = async (): Promise<string | null> => {
  if (!isCloudBackendEnabled()) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
};

const toBlob = async (image: string | Blob): Promise<Blob | null> => {
  if (typeof image !== 'string') return image.size > 0 ? image : null;
  if (!/^data:image\//i.test(image) && !/^blob:/i.test(image)) return null;
  try {
    const res = await fetch(image);
    return await res.blob();
  } catch {
    return null;
  }
};

const upload = async (bucket: string, path: string, blob: Blob): Promise<boolean> => {
  if (!isCloudBackendEnabled()) return false;
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType: blob.type || 'image/jpeg',
    cacheControl: '3600',
  });
  if (error) {
    console.warn('[iCalc media] upload failed', bucket, path, error.message);
    return false;
  }
  return true;
};

const download = async (bucket: string, path: string): Promise<Blob | null> => {
  if (!isCloudBackendEnabled()) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data || data.size <= 0) return null;
    return data;
  } catch {
    return null;
  }
};

export async function persistProfileAvatar(input: {
  profileId: string;
  image: string | Blob;
}): Promise<{ ok: true; imageRef: string } | { ok: false; error: string }> {
  const profileId = input.profileId.trim();
  if (!profileId) return { ok: false, error: 'Missing profile id.' };
  const blob = await toBlob(input.image);
  if (!blob) return { ok: false, error: 'Could not read avatar.' };
  const cacheKey = `avatar:${profileId}`;
  await cacheItemImageForItem(cacheKey, blob);
  const userId = await sessionUserId();
  if (userId) {
    await upload(AVATAR_BUCKET, `${userId}/${profileId}.jpg`, blob);
  }
  return { ok: true, imageRef: encodeAvatarRef(profileId) };
}

export async function resolveProfileAvatarUrl(
  avatarRef: string | null | undefined,
  profileId?: string | null
): Promise<string | null> {
  const raw = (avatarRef || '').trim();
  if (/^data:image\//i.test(raw) || /^blob:/i.test(raw) || /^https?:\/\//i.test(raw)) {
    return raw;
  }
  const id = (isAvatarRef(raw) ? raw.slice(AVATAR_PREFIX.length) : profileId || '').trim();
  if (!id) return null;
  const cacheKey = `avatar:${id}`;
  const mem = peekCachedItemImageUrl(`item:${cacheKey}`) || (await readCachedItemImageUrl(`item:${cacheKey}`));
  if (mem) return mem;
  const userId = await sessionUserId();
  if (!userId) return null;
  const blob = await download(AVATAR_BUCKET, `${userId}/${id}.jpg`);
  if (!blob) return null;
  return cacheItemImageForItem(cacheKey, blob);
}

export async function persistWallpaperSet(
  slides: WallpaperSlide[]
): Promise<WallpaperSlide[] | null> {
  const userId = await sessionUserId();
  let changed = false;
  const next: WallpaperSlide[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i];
    const image = slide.image || '';
    if (!/^data:image\//i.test(image) && !/^blob:/i.test(image)) {
      next.push(slide);
      continue;
    }
    const blob = await toBlob(image);
    if (!blob) {
      next.push(slide);
      continue;
    }
    const cacheKey = `wall:${i}`;
    await cacheItemImageForItem(cacheKey, blob);
    if (userId) await upload(WALL_BUCKET, `${userId}/${i}.jpg`, blob);
    next.push({ ...slide, image: encodeWallpaperRef(i) });
    changed = true;
  }
  return changed ? next : null;
}

export async function resolveWallpaperUrl(
  image: string | null | undefined,
  index = 0
): Promise<string> {
  const raw = (image || '').trim();
  if (!raw) return '';
  if (isWallpaperRef(raw) || raw.startsWith('tgfile:') || raw.startsWith('itemimg:')) {
    const idx = isWallpaperRef(raw) ? Number(raw.slice(WALL_PREFIX.length)) || index : index;
    const cacheKey = `wall:${idx}`;
    const mem =
      peekCachedItemImageUrl(`item:${cacheKey}`) || (await readCachedItemImageUrl(`item:${cacheKey}`));
    if (mem) return mem;
    const userId = await sessionUserId();
    if (userId) {
      const blob = await download(WALL_BUCKET, `${userId}/${idx}.jpg`);
      if (blob) {
        const url = await cacheItemImageForItem(cacheKey, blob);
        if (url) return url;
      }
    }
    return '';
  }
  return resolveWallpaperImage(raw);
}

export async function hydrateProfileAvatars(
  profiles: Array<{ id: string; avatarUrl?: string }>
): Promise<void> {
  await Promise.all(
    profiles.map((profile) => resolveProfileAvatarUrl(profile.avatarUrl, profile.id))
  );
}
