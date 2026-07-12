export type PwaInstallMode = 'chromium' | 'ios-safari' | 'ios-other';

export const isPwaInstalled = (): boolean => {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    nav.standalone === true
  );
};

export const isIOSDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIPad =
    /iPad/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return /iPhone|iPod/i.test(ua) || isIPad;
};

/** Safari on iOS supports Add to Home Screen; other iOS browsers need Safari. */
export const isIOSSafariBrowser = (): boolean => {
  if (!isIOSDevice()) return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
};

export const getIOSInstallMode = (): 'ios-safari' | 'ios-other' | null => {
  if (!isIOSDevice() || isPwaInstalled()) return null;
  return isIOSSafariBrowser() ? 'ios-safari' : 'ios-other';
};

export const canShowPwaInstall = (hasDeferredPrompt: boolean): boolean => {
  if (isPwaInstalled()) return false;
  return hasDeferredPrompt || getIOSInstallMode() !== null;
};