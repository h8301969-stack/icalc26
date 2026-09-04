import React, { useEffect, useState } from 'react';
import { DEFAULT_INVENTORY_IMAGE, resolveInventoryImage } from '../utils/wallpapers';
import { itemCacheKey, peekCachedItemImageUrl, readCachedItemImageForItem } from '../utils/itemImageCache';
import {
  isDurableItemImageRef,
  isItemImageRef,
  resolveItemImageUrl,
} from '../utils/itemImageSync';
import { isTelegramItemImageRef } from '../utils/telegramDb';

interface InventoryItemImageProps {
  image?: string | null;
  alt: string;
  className?: string;
  accountId?: string | null;
  itemId?: string | null;
}

const initialSrc = (
  image: string | null | undefined,
  itemId?: string | null
): string => {
  if (itemId) {
    const local = peekCachedItemImageUrl(itemCacheKey(itemId));
    if (local) return local;
  }
  if (isTelegramItemImageRef(image) || isItemImageRef(image)) {
    return DEFAULT_INVENTORY_IMAGE;
  }
  return resolveInventoryImage(image);
};

/**
 * Renders inventory photos.
 * Sequence: phone/local cache → Supabase (new device login) → Telegram (permanent).
 */
const InventoryItemImage: React.FC<InventoryItemImageProps> = ({
  image,
  alt,
  className,
  accountId = null,
  itemId = null,
}) => {
  const [src, setSrc] = useState(() => initialSrc(image, itemId));

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (isDurableItemImageRef(image)) {
        const url = await resolveItemImageUrl(accountId, image, itemId);
        if (!cancelled && url) setSrc(url);
        return;
      }

      if (itemId) {
        const local = await readCachedItemImageForItem(itemId);
        if (!cancelled && local) {
          setSrc(local);
          return;
        }
      }

      if (!cancelled) setSrc(resolveInventoryImage(image));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [accountId, image, itemId]);

  return <img src={src} alt={alt} className={className} />;
};

export default InventoryItemImage;
