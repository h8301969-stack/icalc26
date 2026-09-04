import { Capacitor } from '@capacitor/core';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

export const isPwaRuntime = (): boolean =>
  !isNativeApp() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

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
