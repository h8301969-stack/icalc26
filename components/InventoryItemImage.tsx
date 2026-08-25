import React, { useEffect, useState } from 'react';
import { DEFAULT_INVENTORY_IMAGE, resolveInventoryImage } from '../utils/wallpapers';
import {
  isTelegramItemImageRef,
  telegramResolveItemImageUrl,
} from '../utils/telegramDb';

interface InventoryItemImageProps {
  image?: string | null;
  alt: string;
  className?: string;
  accountId?: string | null;
}

/**
 * Renders inventory photos. Local data URLs / http(s) resolve sync;
 * `tgfile:` refs load from Telegram (cached) using the shop bot link.
 */
const InventoryItemImage: React.FC<InventoryItemImageProps> = ({
  image,
  alt,
  className,
  accountId = null,
}) => {
  const [src, setSrc] = useState(() =>
    isTelegramItemImageRef(image) ? DEFAULT_INVENTORY_IMAGE : resolveInventoryImage(image)
  );

  useEffect(() => {
    let cancelled = false;
    if (!isTelegramItemImageRef(image)) {
      setSrc(resolveInventoryImage(image));
      return;
    }
    setSrc(DEFAULT_INVENTORY_IMAGE);
    void telegramResolveItemImageUrl(accountId, image).then((url) => {
      if (!cancelled && url) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, image]);

  return <img src={src} alt={alt} className={className} />;
};

export default InventoryItemImage;
