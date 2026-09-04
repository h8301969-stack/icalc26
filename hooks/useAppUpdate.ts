import { useCallback, useEffect, useState } from 'react';
import {
  downloadWithProgress,
  PHONE_APP_DOWNLOAD_URL,
  restartNativeApp,
  restartPwa,
  saveApkToDevice,
  shareDownloadedApk,
  startPwaUpdate,
} from '../utils/appUpdate';
import {
  checkForPwaUpdate,
  getAppRuntimeKind,
  getWaitingWorker,
  promptPwaInstall,
  requestPwaInstallUi,
  type AppRuntimeKind,
} from '../utils/pwa';
import {
  buildPhoneUpdateStatus,
  fetchLatestPhoneRelease,
  getInstalledAppVersion,
  type PhoneUpdateStatus,
} from '../utils/appRelease';

export type AppUpdateUiPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'current'
  | 'error';

export interface AppUpdateState {
  phase: AppUpdateUiPhase;
  progress: number;
  message: string;
  error: string | null;
  status: PhoneUpdateStatus | null;
  runtime: AppRuntimeKind;
  startUpdate: () => void;
  restart: () => void;
}

export function useAppUpdate(enabled: boolean): AppUpdateState {
  const runtime = getAppRuntimeKind();
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

      if (runtime === 'pwa') {
        const waiting = await getWaitingWorker();
        if (cancelled) return;
        if (waiting) {
          setPhase('available');
          setMessage('A new iCalc update is ready.');
          return;
        }
        if (next.kind === 'current') {
          setPhase('current');
          setMessage(next.message);
          return;
        }
        setPhase('available');
        setMessage(next.kind === 'update' ? next.message : 'Check for a new iCalc update.');
        return;
      }

      if (runtime === 'native') {
        if (next.kind === 'current') {
          setPhase('current');
          setMessage(next.message);
          return;
        }
        setPhase('available');
        setMessage(next.kind === 'update' ? next.message : 'Download the latest iCalc app.');
        return;
      }

      setPhase('available');
      setMessage('Install iCalc on this phone.');
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, runtime]);

  const startUpdate = useCallback(() => {
    if (phase === 'downloading' || phase === 'ready') return;
    setError(null);

    if (runtime === 'web') {
      requestPwaInstallUi();
      void promptPwaInstall().then((outcome) => {
        if (outcome === 'accepted') {
          setPhase('current');
          setMessage('iCalc is installed.');
        }
      });
      return;
    }

    setPhase('downloading');
    setProgress(0.02);
    setMessage('Updating… stay in the app.');

    void (async () => {
      try {
        if (runtime === 'native') {
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

        await startPwaUpdate((ratio) => setProgress(ratio));
        await checkForPwaUpdate();
        setProgress(1);
        setPhase('ready');
        setMessage('Update downloaded. Tap Restart to apply.');
      } catch (err) {
        setPhase('error');
        setError(err instanceof Error ? err.message : 'Update failed.');
        setMessage('Could not finish the update.');
      }
    })();
  }, [phase, runtime]);

  const restart = useCallback(() => {
    if (runtime === 'native') {
      if (apkUri) void shareDownloadedApk(apkUri);
      void restartNativeApp();
      return;
    }
    restartPwa();
  }, [apkUri, runtime]);

  return { phase, progress, message, error, status, runtime, startUpdate, restart };
}
