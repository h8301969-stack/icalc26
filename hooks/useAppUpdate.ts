import { useCallback, useEffect, useRef, useState } from 'react';
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
  isNativeApp,
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

export type AppUpdateUiPhase = 'idle' | 'downloading' | 'ready' | 'error';
export type AppUpdateTarget = 'pwa' | 'apk' | null;

export interface AppUpdateState {
  phase: AppUpdateUiPhase;
  target: AppUpdateTarget;
  progress: number;
  message: string;
  error: string | null;
  status: PhoneUpdateStatus | null;
  statusLoading: boolean;
  runtime: AppRuntimeKind;
  startPwa: () => void;
  startApk: () => void;
  restart: () => void;
}

const downloadApkInBrowser = (): void => {
  const link = document.createElement('a');
  link.href = PHONE_APP_DOWNLOAD_URL;
  link.rel = 'noopener';
  link.download = 'icalc.apk';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export function useAppUpdate(enabled: boolean): AppUpdateState {
  const runtime = getAppRuntimeKind();
  const [phase, setPhase] = useState<AppUpdateUiPhase>('idle');
  const [target, setTarget] = useState<AppUpdateTarget>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [apkUri, setApkUri] = useState<string | null>(null);
  const [status, setStatus] = useState<PhoneUpdateStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const checkRef = useRef<{
    release: Awaited<ReturnType<typeof fetchLatestPhoneRelease>>;
    installed: string;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatusLoading(true);

    void Promise.all([fetchLatestPhoneRelease(), getInstalledAppVersion()]).then(
      ([release, installed]) => {
        if (cancelled) return;
        checkRef.current = { release, installed };
        setStatus(buildPhoneUpdateStatus(installed, release, Date.now()));
        setStatusLoading(false);
      }
    );

    const tick = window.setInterval(() => {
      const checked = checkRef.current;
      if (!checked) return;
      setStatus(buildPhoneUpdateStatus(checked.installed, checked.release, Date.now()));
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [enabled]);

  const startPwa = useCallback(() => {
    if (phase === 'downloading') return;
    setError(null);
    setTarget('pwa');

    if (runtime === 'web' || (runtime !== 'pwa' && !isNativeApp())) {
      requestPwaInstallUi();
      void promptPwaInstall();
      return;
    }

    setPhase('downloading');
    setProgress(0.05);
    setMessage('Updating home-screen app…');

    void (async () => {
      try {
        await startPwaUpdate((ratio) => setProgress(ratio));
        await checkForPwaUpdate();
        setProgress(1);
        setPhase('ready');
        setMessage('Home-screen update ready. Tap Restart.');
      } catch (err) {
        setPhase('error');
        setError(err instanceof Error ? err.message : 'PWA update failed.');
        setMessage('Could not update the home-screen app.');
      }
    })();
  }, [phase, runtime]);

  const startApk = useCallback(() => {
    if (phase === 'downloading') return;
    setError(null);
    setTarget('apk');
    setPhase('downloading');
    setProgress(0.02);
    setMessage('Downloading APK… stay in the app.');

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

        downloadApkInBrowser();
        setProgress(1);
        setPhase('ready');
        setMessage('APK download started.');
      } catch (err) {
        setPhase('error');
        setError(err instanceof Error ? err.message : 'APK download failed.');
        setMessage('Could not download the APK.');
      }
    })();
  }, [phase]);

  const restart = useCallback(() => {
    if (target === 'apk') {
      if (apkUri) void shareDownloadedApk(apkUri);
      if (isNativeApp()) {
        void restartNativeApp();
        return;
      }
    }
    restartPwa();
  }, [apkUri, target]);

  return {
    phase,
    target,
    progress,
    message,
    error,
    status,
    statusLoading,
    runtime,
    startPwa,
    startApk,
    restart,
  };
}
