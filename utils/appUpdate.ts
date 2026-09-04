/**
 * In-app update for PWA (service worker) and Capacitor (APK download).
 * Stays on-screen with byte progress; caller shows a green Restart when ready.
 */

import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { PHONE_APP_DOWNLOAD_URL } from './appRelease';
import { activateWaitingWorker, checkForPwaUpdate, isNativeApp, isPwaRuntime } from './pwa';

export type AppUpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

const APK_PATH = 'icalc-update.apk';

const uint8ToBase64 = (bytes: Uint8Array): string => {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    let part = '';
    for (let j = 0; j < slice.length; j += 1) part += String.fromCharCode(slice[j]);
    binary += part;
  }
  return btoa(binary);
};

export async function downloadWithProgress(
  url: string,
  onProgress: (ratio: number) => void
): Promise<Blob> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  if (!res.body) return res.blob();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (total > 0) onProgress(Math.min(0.99, received / total));
      else onProgress(Math.min(0.9, received / (received + 400000)));
    }
  }
  onProgress(1);
  return new Blob(chunks, { type: 'application/vnd.android.package-archive' });
}

export async function saveApkToDevice(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const data = uint8ToBase64(buffer);
  await Filesystem.writeFile({
    path: APK_PATH,
    data,
    directory: Directory.Cache,
  });
  const { uri } = await Filesystem.getUri({
    path: APK_PATH,
    directory: Directory.Cache,
  });
  return uri;
}

export async function shareDownloadedApk(uri: string): Promise<void> {
  try {
    await Share.share({
      title: 'Install iCalc',
      text: 'Install the new iCalc build, then tap Restart.',
      url: uri,
      dialogTitle: 'Install iCalc update',
    });
  } catch {
    /* user cancelled share — still allow Restart */
  }
}

/** Apply a waiting PWA worker, then reload. */
export function restartPwa(): void {
  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };
  navigator.serviceWorker?.addEventListener('controllerchange', reload);
  activateWaitingWorker();
  window.setTimeout(reload, 800);
}

export async function restartNativeApp(): Promise<void> {
  try {
    await CapApp.exitApp();
  } catch {
    window.location.reload();
  }
}

export async function startPwaUpdate(onProgress: (ratio: number) => void): Promise<void> {
  onProgress(0.15);
  const reg = await checkForPwaUpdate();
  onProgress(0.45);
  if (!reg) throw new Error('Could not register the web app update.');

  const installing = reg.installing;
  if (installing) {
    await new Promise<void>((resolve, reject) => {
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed') {
          onProgress(0.9);
          resolve();
        }
        if (installing.state === 'redundant') {
          reject(new Error('Update was interrupted.'));
        }
      });
    });
  }
  onProgress(1);
}

export { Capacitor, isNativeApp, isPwaRuntime, PHONE_APP_DOWNLOAD_URL };
