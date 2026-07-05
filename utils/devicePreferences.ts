export type ThemeMode = 'light' | 'dark' | 'system';
export type LayoutMode = 'portrait' | 'landscape';
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';

export const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const resolveThemeMode = (themeMode: ThemeMode): 'light' | 'dark' =>
  themeMode === 'system' ? getSystemTheme() : themeMode;

export const getDeviceClass = (): DeviceClass => {
  if (typeof window === 'undefined') return 'mobile';

  const w = window.innerWidth;
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 0;
  const tabletUa =
    /iPad|Tablet|PlayBook/i.test(ua) ||
    (touch && /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const mobileUa = /Android|iPhone|iPod|Mobile/i.test(ua);

  if (tabletUa || (touch && w >= 768 && w < 1100)) return 'tablet';
  if (mobileUa || (touch && Math.min(w, window.innerHeight) < 720)) return 'mobile';
  return 'desktop';
};

export const getAutoLayoutMode = (): LayoutMode => {
  if (typeof window === 'undefined') return 'portrait';

  const device = getDeviceClass();
  const isPortraitOrient = window.matchMedia('(orientation: portrait)').matches;

  if (device === 'mobile') {
    return isPortraitOrient ? 'portrait' : 'landscape';
  }

  if (!isPortraitOrient || window.innerWidth >= 900) {
    return 'landscape';
  }

  return 'portrait';
};