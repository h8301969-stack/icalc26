import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Icons } from '../constants';
import {
  acknowledgeReleaseBuild,
  consumeReturnFromInactivity,
  dismissUpdatePrompt,
  fetchLatestReleaseMeta,
  hasCompletedFirstActiveTwoHours,
  markTwoHourPromptFired,
  noteAppHidden,
  noteSessionActiveStart,
  resolveDownloadUrl,
  shouldOfferUpdate,
  shouldShowActivityUpdatePrompt,
  startBackgroundApkDownload,
  UPDATE_PROMPT_ACTIVE_MS,
  type ReleaseMeta,
} from '../utils/appVersion';

interface UpdatePromptModalProps {
  isLight: boolean;
  /** Only show after the user is past the lock/auth screen (unlocked). */
  enabled: boolean;
}

/**
 * Update prompt when:
 * - first active 2 hours in this session, or
 * - re-entering the app after inactivity (lock / background).
 * Download starts in a new tab so work can continue.
 */
const UpdatePromptModal: React.FC<UpdatePromptModalProps> = ({ isLight, enabled }) => {
  const [open, setOpen] = useState(false);
  const [meta, setMeta] = useState<ReleaseMeta | null>(null);
  const [starting, setStarting] = useState(false);
  const wasEnabledRef = useRef(false);
  const twoHourTimerRef = useRef<number | null>(null);

  const tryOpen = useCallback(
    async (opts: { forceInactivity?: boolean; forceTwoHour?: boolean } = {}) => {
      if (!enabled) {
        setOpen(false);
        return;
      }

      const returnedFromInactivity =
        opts.forceInactivity === true || consumeReturnFromInactivity();
      const twoHourReady = opts.forceTwoHour === true || hasCompletedFirstActiveTwoHours();

      if (!returnedFromInactivity && !twoHourReady) {
        setOpen(false);
        return;
      }

      const latest = await fetchLatestReleaseMeta();
      setMeta(latest);
      const isNative = Capacitor.isNativePlatform();
      const updateAvailable = shouldOfferUpdate(isNative, latest);
      const remoteBuild = latest?.build ?? 0;

      const mayShow = shouldShowActivityUpdatePrompt({
        updateAvailable,
        remoteBuild,
        twoHourReady,
        returnedFromInactivity,
      });

      if (mayShow) {
        if (twoHourReady) markTwoHourPromptFired();
        setOpen(true);
      } else {
        setOpen(false);
      }
    },
    [enabled]
  );

  // Session active clock + schedule 2-hour prompt; lock = inactivity
  useEffect(() => {
    if (!enabled) {
      if (wasEnabledRef.current) {
        noteAppHidden();
      }
      wasEnabledRef.current = false;
      if (twoHourTimerRef.current != null) {
        window.clearTimeout(twoHourTimerRef.current);
        twoHourTimerRef.current = null;
      }
      setOpen(false);
      return;
    }

    const justEntered = !wasEnabledRef.current;
    wasEnabledRef.current = true;
    noteSessionActiveStart();

    if (justEntered) {
      // Unlock after lock / standby, or first open after background
      void tryOpen();
    }

    if (twoHourTimerRef.current != null) {
      window.clearTimeout(twoHourTimerRef.current);
      twoHourTimerRef.current = null;
    }

    if (!hasCompletedFirstActiveTwoHours()) {
      let startMs = Date.now();
      try {
        const raw = sessionStorage.getItem('icalc_session_active_start');
        if (raw) startMs = Number(raw) || Date.now();
      } catch {
        /* ignore */
      }
      const remaining = Math.max(0, UPDATE_PROMPT_ACTIVE_MS - (Date.now() - startMs));
      twoHourTimerRef.current = window.setTimeout(() => {
        void tryOpen({ forceTwoHour: true });
      }, remaining + 50);
    } else {
      void tryOpen({ forceTwoHour: true });
    }

    return () => {
      if (twoHourTimerRef.current != null) {
        window.clearTimeout(twoHourTimerRef.current);
        twoHourTimerRef.current = null;
      }
    };
  }, [enabled, tryOpen]);

  // Tab / app background → inactivity; return → prompt
  useEffect(() => {
    if (!enabled) return;

    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        noteAppHidden();
      } else {
        void tryOpen();
      }
    };
    const onPageHide = () => noteAppHidden();
    const onFocus = () => void tryOpen();

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, tryOpen]);

  const handleCancel = () => {
    dismissUpdatePrompt(meta?.build ?? 0);
    markTwoHourPromptFired();
    setOpen(false);
  };

  const handleUpdate = () => {
    setStarting(true);
    const url = resolveDownloadUrl(meta);
    startBackgroundApkDownload(url);
    if (meta?.build) acknowledgeReleaseBuild(meta.build);
    dismissUpdatePrompt(meta?.build ?? 0);
    markTwoHourPromptFired();
    window.setTimeout(() => {
      setStarting(false);
      setOpen(false);
    }, 800); // loading dismiss within 0.4s–2s
  };

  if (!open) return null;

  const versionLabel = meta?.version ? `v${meta.version}` : 'latest';
  const buildLabel = meta?.build ? ` · build ${meta.build}` : '';

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-5 bg-black/50 backdrop-blur-sm morph-scrim morph-scrim--in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-prompt-title"
    >
      <div
        className={`w-full max-w-sm rounded-2xl border p-5 shadow-2xl fluid-pop-in ${
          isLight ? 'bg-white border-black/10 text-black' : 'bg-zinc-900 border-white/10 text-white'
        }`}
      >
        <div className="flex items-start gap-3 mb-3">
          <div
            className={`p-2 rounded-xl ${isLight ? 'bg-blue-500/10 text-blue-600' : 'bg-blue-500/20 text-blue-300'}`}
          >
            <Icons.Download size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="update-prompt-title" className="text-sm font-black tracking-wide">
              Update available
            </h3>
            <p className={`app-subtext text-[10px] mt-1 opacity-70 ${isLight ? 'text-black' : 'text-white'}`}>
              {versionLabel}
              {buildLabel} is ready to install.
            </p>
          </div>
        </div>

        <p className={`app-subtext text-[10px] leading-relaxed mb-5 opacity-60 ${isLight ? 'text-black' : 'text-white'}`}>
          Don&apos;t worry, updating will do in background, while you still work.
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleUpdate}
            disabled={starting}
            className="w-full py-3.5 rounded-xl bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest disabled:opacity-60 transition-all"
          >
            {starting ? 'Starting download…' : 'Click to update'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={starting}
            className={`w-full py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest disabled:opacity-60 transition-all ${
              isLight ? 'border-black/15 text-black/70 hover:bg-black/5' : 'border-white/15 text-white/70 hover:bg-white/5'
            }`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpdatePromptModal;
