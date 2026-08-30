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
 * Renders inventory photos. http(s) resolve sync;
 * `tgfile:` refs load from durable offline cache, then Telegram (shop bot link).
 * Large data: URLs are not kept on inventory rows — upload to Telegram instead.
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
