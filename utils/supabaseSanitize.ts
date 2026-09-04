/** Strip huge inline images from cloud payloads; keep durable short refs (itemimg:/tgfile:/http). */

const INLINE_IMAGE_RE = /^data:image\//i;
const MAX_PERSISTABLE_URL_LEN = 512;
const TG_FILE_RE = /^tgfile:/i;
const ITEM_IMG_RE = /^itemimg:/i;
const HTTP_URL_RE = /^https?:\/\//i;

export const isInlineImageData = (value: string | null | undefined): boolean => {
  if (!value) return false;
  if (INLINE_IMAGE_RE.test(value)) return true;
  return value.length > MAX_PERSISTABLE_URL_LEN;
};

/**
 * Persist durable image refs to Supabase; drop base64 blobs that blow up rows.
 * Keeps `itemimg:…` (local/cache key), `tgfile:…` (Telegram), and short http(s) URLs.
 */
export const sanitizeImageRefForDb = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ITEM_IMG_RE.test(trimmed) || TG_FILE_RE.test(trimmed)) return trimmed;
  if (HTTP_URL_RE.test(trimmed) && trimmed.length <= MAX_PERSISTABLE_URL_LEN) return trimmed;
  // data: / huge payloads stay on-device only
  return null;
};

export const sanitizeWallpapersForDb = <T extends { image: string; header: string; subHeader: string }>(
  slides: T[]
): Array<{ image: string; header: string; subHeader: string }> =>
  slides.map((slide) => ({
    header: slide.header,
    subHeader: slide.subHeader,
    image: sanitizeImageRefForDb(slide.image) ?? '',
  }));

export const sanitizeAvatarForDb = (avatarUrl: string | undefined): string =>
  sanitizeImageRefForDb(avatarUrl) ?? '';
