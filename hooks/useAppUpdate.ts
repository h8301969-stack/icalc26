import { useCallback, useEffect, useState } from 'react';
import {
  downloadWithProgress,
  isNativeApp,
  isPwaRuntime,
  PHONE_APP_DOWNLOAD_URL,
  restartNativeApp,
  restartPwa,
  saveApkToDevice,
  shareDownloadedApk,
  startPwaUpdate,
} from '../utils/appUpdate';
import { checkForPwaUpdate, getWaitingWorker } from '../utils/pwa';
import {
  buildPhoneUpdateStatus,
  fetchLatestPhoneRelease,
  getInstalledAppVersion,
  type PhoneUpdateStatus,
} from '../utils/appRelease';

export type AppUpdateUiPhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'current' | 'error';

export interface AppUpdateState {
  phase: AppUpdateUiPhase;
  progress: number;
  message: string;
  error: string | null;
  status: PhoneUpdateStatus | null;
  startUpdate: () => void;
  restart: () => void;
}

export function useAppUpdate(enabled: boolean): AppUpdateState {
  const [phase, setPhase] = useState<AppUpdateUiPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('Checking for updates…');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<PhoneUpdateStatus | null>(null);
  const [apkUri, setApkUri] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setPhase('checking');
    setError(null);

    void (async () => {
      const [release, installed] = await Promise.all([
        fetchLatestPhoneRelease(),
        getInstalledAppVersion(),
      ]);
      if (cancelled) return;
      const next = buildPhoneUpdateStatus(installed, release);
      setStatus(next);

      const waiting = isPwaRuntime() ? await getWaitingWorker() : null;
      if (cancelled) return;
      if (waiting) {
        setPhase('available');
        setMessage('A new web build is ready.');
        return;
      }

      if (next.kind === 'current' && isNativeApp()) {
        setPhase('current');
        setMessage(next.message);
        return;
      }
      if (next.kind === 'update') {
        setPhase('available');
        setMessage(next.message);
        return;
      }
      if (isPwaRuntime()) {
        setPhase('available');
        setMessage(next.kind === 'unknown' ? 'Check for a new web build, or install on your phone.' : next.message);
        return;
      }
      setPhase('available');
      setMessage(next.message);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const startUpdate = useCallback(() => {
    if (phase === 'downloading' || phase === 'ready') return;
    setError(null);
    setPhase('downloading');
    setProgress(0.02);
    setMessage('Updating… stay in the app.');

    void (async () => {
      try {
        if (isNativeApp()) {
          const blob = await downloadWithProgress(PHONE_APP_DOWNLOAD_URL, (ratio) => {
            setProgress(ratio);
          });
          const uri = await saveApkToDevice(blob);
          setApkUri(uri);
          await shareDownloadedApk(uri);
          setProgress(1);
          setPhase('ready');
          setMessage('Install the APK if prompted, then tap Restart.');
          return;
        }

        if (isPwaRuntime()) {
          await startPwaUpdate((ratio) => setProgress(ratio));
          await checkForPwaUpdate();
          setProgress(1);
          setPhase('ready');
          setMessage('Update downloaded. Tap Restart to apply.');
          return;
        }

        const blob = await downloadWithProgress(PHONE_APP_DOWNLOAD_URL, (ratio) => {
          setProgress(ratio);
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'icalc.apk';
        a.click();
        setProgress(1);
        setPhase('ready');
        setMessage('Download finished. Tap Restart when the install completes.');
      } catch (err) {
        setPhase('error');
        setError(err instanceof Error ? err.message : 'Update failed.');
        setMessage('Could not finish the update.');
      }
    })();
  }, [phase]);

  const restart = useCallback(() => {
    if (isNativeApp()) {
      if (apkUri) void shareDownloadedApk(apkUri);
      void restartNativeApp();
      return;
    }
    if (isPwaRuntime()) {
      restartPwa();
      return;
    }
    window.location.reload();
  }, [apkUri]);

  return { phase, progress, message, error, status, startUpdate, restart };
}
