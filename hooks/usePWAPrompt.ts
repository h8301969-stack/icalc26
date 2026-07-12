import { useState, useEffect, useCallback } from 'react';
import {
  getIOSInstallMode,
  isPwaInstalled,
  type PwaInstallMode,
} from '../utils/pwaInstall';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export { isPwaInstalled } from '../utils/pwaInstall';

export const usePWAPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => isPwaInstalled());
  const [iosInstallMode, setIosInstallMode] = useState<ReturnType<typeof getIOSInstallMode>>(() =>
    getIOSInstallMode()
  );

  const syncInstalled = useCallback(() => {
    const installed = isPwaInstalled();
    setIsInstalled(installed);
    if (installed) {
      setShowPrompt(false);
      setDeferredPrompt(null);
      setIosInstallMode(null);
    } else {
      setIosInstallMode(getIOSInstallMode());
    }
    return installed;
  }, []);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      if (syncInstalled()) return;
      e.preventDefault();
      const event = e as BeforeInstallPromptEvent;
      setDeferredPrompt(event);
      window.setTimeout(() => {
        if (syncInstalled()) return;
        setShowPrompt(true);
      }, 1000);
    };

    const handleAppInstalled = () => {
      syncInstalled();
    };

    syncInstalled();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [syncInstalled]);

  const installMode: PwaInstallMode | null = deferredPrompt
    ? 'chromium'
    : iosInstallMode;

  const handleInstall = async () => {
    if (isInstalled) return;

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome !== 'accepted') {
          setShowPrompt(false);
        }
        setDeferredPrompt(null);
        syncInstalled();
      } catch (err) {
        console.error('Error handling install prompt:', err);
      }
      return;
    }

    if (iosInstallMode) {
      setShowPrompt(true);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
  };

  const canInstall = !isInstalled && installMode !== null;

  return {
    showPrompt: showPrompt && !isInstalled,
    canInstall,
    isInstalled,
    installMode,
    handleInstall,
    handleDismiss,
  };
};