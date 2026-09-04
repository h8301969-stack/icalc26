import { describe, expect, it } from 'vitest';
import { stripInlineInventoryImage } from '../hooks/usePOS';
import {
  encodeItemImageRef,
  isDurableItemImageRef,
  isItemImageRef,
  parseItemImageRef,
} from './itemImageSync';
import { encodeTelegramItemImageRef, isTelegramItemImageRef } from './telegramDb';

describe('item image refs', () => {
  it('encodes and parses itemimg refs', () => {
    expect(encodeItemImageRef(' abc-1 ')).toBe('itemimg:abc-1');
    expect(parseItemImageRef('itemimg:abc-1')).toBe('abc-1');
    expect(isItemImageRef('itemimg:abc-1')).toBe(true);
    expect(isItemImageRef('tgfile:x')).toBe(false);
  });

  it('treats local, telegram, and http refs as durable', () => {
    expect(isDurableItemImageRef('itemimg:abc-1')).toBe(true);
    expect(isDurableItemImageRef(encodeTelegramItemImageRef('FILE'))).toBe(true);
    expect(isTelegramItemImageRef('tgfile:FILE')).toBe(true);
    expect(isDurableItemImageRef('https://cdn.example/a.jpg')).toBe(true);
    expect(isDurableItemImageRef('data:image/png;base64,AAAA')).toBe(false);
  });

  it('keeps short durable refs in inventory persistence', () => {
    expect(stripInlineInventoryImage('itemimg:abc-1', 'fallback')).toBe('itemimg:abc-1');
    expect(stripInlineInventoryImage('tgfile:FILE', 'fallback')).toBe('tgfile:FILE');
    expect(stripInlineInventoryImage('data:image/png;base64,AAAA', 'fallback')).toBe('fallback');
  });
});
