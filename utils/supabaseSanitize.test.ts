import { describe, expect, it } from 'vitest';
import { sanitizeImageRefForDb } from './supabaseSanitize';

describe('sanitizeImageRefForDb', () => {
  it('keeps Telegram file refs and short http urls', () => {
    expect(sanitizeImageRefForDb('tgfile:ABC123')).toBe('tgfile:ABC123');
    expect(sanitizeImageRefForDb('https://example.com/a.jpg')).toBe('https://example.com/a.jpg');
  });

  it('drops inline data images', () => {
    expect(sanitizeImageRefForDb('data:image/png;base64,AAAA')).toBeNull();
    expect(sanitizeImageRefForDb('')).toBeNull();
    expect(sanitizeImageRefForDb(null)).toBeNull();
  });
});
