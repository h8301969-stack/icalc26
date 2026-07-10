/** Images stay on-device only — Supabase stores structured data, never image payloads or URLs. */

const INLINE_IMAGE_RE = /^data:image\//i;
const MAX_PERSISTABLE_URL_LEN = 512;

export const isInlineImageData = (value: string | null | undefined): boolean => {
  if (!value) return false;
  if (INLINE_IMAGE_RE.test(value)) return true;
  return value.length > MAX_PERSISTABLE_URL_LEN;
};

/** Always null — image refs are never written to Supabase. */
export const sanitizeImageRefForDb = (_value: string | null | undefined): string | null => null;

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