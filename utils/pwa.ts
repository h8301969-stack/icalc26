import { Capacitor } from '@capacitor/core';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type InstallListener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<InstallListener>();
let captureBound = false;
let forceShowInstall = false;

const notifyInstallListeners = (): void => {
  for (const listener of installListeners) listener();
};

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

export const isStandalonePwa = (): boolean => {
  if (typeof window === 'undefined' || isNativeApp()) return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
};

export const isPwaRuntime = (): boolean =>
  !isNativeApp() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

export const isIosSafari = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const crios = /CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webkit && !crios;
};

/** Browser tab that can become a PWA (not native, not already installed). */
export const shouldOfferPwaInstall = (): boolean => !isNativeApp() && !isStandalonePwa();

export function subscribePwaInstall(listener: InstallListener): () => void {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

export function capturePwaInstallPrompt(): void {
  if (captureBound || typeof window === 'undefined') return;
  captureBound = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyInstallListeners();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyInstallListeners();
  });
}

export const canNativePwaPrompt = (): boolean => !!deferredPrompt;

export function requestPwaInstallUi(): void {
  forceShowInstall = true;
  try {
    sessionStorage.removeItem('icalc_pwa_install_dismissed');
  } catch {
    /* ignore */
  }
  notifyInstallListeners();
}

export function consumeForcePwaInstallUi(): boolean {
  const next = forceShowInstall;
  forceShowInstall = false;
  return next;
}

export async function promptPwaInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const event = deferredPrompt;
  deferredPrompt = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    notifyInstallListeners();
    return outcome;
  } catch {
    notifyInstallListeners();
    return 'unavailable';
  }
}

export async function registerPwa(): Promise<ServiceWorkerRegistration | null> {
  if (!isPwaRuntime()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (error) {
    console.warn('[iCalc pwa] register failed', error);
    return null;
  }
}

export async function unregisterServiceWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const reg of regs) void reg.unregister();
  if ('caches' in window) {
    const keys = await caches.keys();
    for (const key of keys) void caches.delete(key);
  }
}

export async function getWaitingWorker(): Promise<ServiceWorker | null> {
  if (!isPwaRuntime()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.waiting ?? null;
}

export async function checkForPwaUpdate(): Promise<ServiceWorkerRegistration | null> {
  if (!isPwaRuntime()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return registerPwa();
  try {
    await reg.update();
  } catch {
    /* ignore */
  }
  return reg;
}

export function activateWaitingWorker(): void {
  void navigator.serviceWorker.getRegistration().then((reg) => {
    reg?.waiting?.postMessage('SKIP_WAITING');
  });
}

export type AppRuntimeKind = 'native' | 'pwa' | 'web';

export const getAppRuntimeKind = (): AppRuntimeKind => {
  if (isNativeApp()) return 'native';
  if (isStandalonePwa()) return 'pwa';
  return 'web';
};
