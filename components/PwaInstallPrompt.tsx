import React, { useEffect, useState } from 'react';
import { PHONE_APP_DOWNLOAD_URL } from '../utils/appRelease';
import {
  consumeForcePwaInstallUi,
  isAndroidWeb,
  isIosWeb,
  promptPwaInstall,
  shouldOfferPwaInstall,
  subscribePwaInstall,
} from '../utils/pwa';

interface PwaInstallPromptProps {
  isLight: boolean;
}

const SESSION_DISMISS_KEY = 'icalc_pwa_install_dismissed';

/**
 * Browser-tab install:
 * Android — choose PWA (home screen) or APK download.
 * iOS — Install starts the Add to Home Screen PWA flow.
 */
const PwaInstallPrompt: React.FC<PwaInstallPromptProps> = ({ isLight }) => {
  const [open, setOpen] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const android = isAndroidWeb();
  const ios = isIosWeb();

  useEffect(() => {
    if (!shouldOfferPwaInstall()) return;

    const consider = () => {
      if (!shouldOfferPwaInstall()) {
        setOpen(false);
        return;
      }
      if (consumeForcePwaInstallUi()) {
        setOpen(true);
        return;
      }
      if (sessionStorage.getItem(SESSION_DISMISS_KEY) === '1') return;
      setOpen(true);
    };

    const timer = window.setTimeout(consider, 600);
    const unsub = subscribePwaInstall(consider);
    return () => {
      window.clearTimeout(timer);
      unsub();
    };
  }, []);

  if (!open || !shouldOfferPwaInstall()) return null;

  const dismiss = () => {
    sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    setOpen(false);
  };

  const installPwa = async () => {
    if (ios) {
      setIosHelp(true);
      return;
    }
    setBusy(true);
    const outcome = await promptPwaInstall();
    setBusy(false);
    if (outcome === 'accepted') {
      setOpen(false);
      return;
    }
    if (outcome === 'unavailable') {
      setIosHelp(true);
    }
  };

  const downloadApk = () => {
    const link = document.createElement('a');
    link.href = PHONE_APP_DOWNLOAD_URL;
    link.rel = 'noopener';
    link.download = 'icalc.apk';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const sheet = isLight ? 'bg-white text-zinc-900' : 'bg-[#1c1c1e] text-white';
  const muted = isLight ? 'text-black/55' : 'text-white/55';
  const secondary = isLight ? 'bg-black/8 text-black' : 'bg-white/10 text-white';

  return (
    <div className="fixed inset-0 z-[1400] flex items-end sm:items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        aria-label="Dismiss install"
        onClick={dismiss}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwa-install-title"
        className={`relative w-full max-w-sm rounded-[28px] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] ${sheet}`}
      >
        <div className="flex items-center gap-3">
          <img
            src="/apple-touch-icon.png"
            alt=""
            className="h-14 w-14 rounded-[14px] shadow-md"
          />
          <div className="min-w-0">
            <p id="pwa-install-title" className="text-lg font-black leading-tight">
              Install iCalc
            </p>
            <p className={`app-subtext text-[11px] mt-0.5 ${muted}`} style={{ letterSpacing: 0 }}>
              {android
                ? 'Choose home-screen app or Android APK'
                : 'Add iCalc to your Home Screen'}
            </p>
          </div>
        </div>

        {iosHelp ? (
          <ol className={`mt-4 space-y-2 text-[13px] font-semibold ${muted}`} style={{ letterSpacing: 0 }}>
            <li>1. Tap the Share button</li>
            <li>2. Choose Add to Home Screen</li>
            <li>3. Tap Add — iCalc opens as its own app</li>
          </ol>
        ) : android ? (
          <p className={`mt-4 text-[13px] font-medium leading-relaxed ${muted}`} style={{ letterSpacing: 0 }}>
            Home screen app updates itself. The APK is the full Android build.
          </p>
        ) : (
          <p className={`mt-4 text-[13px] font-medium leading-relaxed ${muted}`} style={{ letterSpacing: 0 }}>
            Tap Install to add iCalc to your Home Screen.
          </p>
        )}

        {android && !iosHelp ? (
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void installPwa()}
              className="w-full py-3 rounded-2xl bg-blue-500 text-white text-xs font-black uppercase disabled:opacity-70"
            >
              {busy ? 'Installing…' : 'Home screen app'}
            </button>
            <button
              type="button"
              onClick={downloadApk}
              className={`w-full py-3 rounded-2xl text-xs font-black uppercase ${secondary}`}
            >
              Download APK
            </button>
            <button
              type="button"
              onClick={dismiss}
              className={`w-full py-2.5 rounded-2xl text-[10px] font-black uppercase opacity-70 ${secondary}`}
            >
              Not now
            </button>
          </div>
        ) : (
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={dismiss}
              className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase ${secondary}`}
            >
              {iosHelp ? 'Close' : 'Not now'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void (iosHelp ? dismiss() : installPwa())}
              className="flex-1 py-3 rounded-2xl bg-blue-500 text-white text-xs font-black uppercase disabled:opacity-70"
            >
              {iosHelp ? 'Got it' : busy ? 'Installing…' : 'Install'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PwaInstallPrompt;
