import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const isPwaInstalled = (): boolean => {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    nav.standalone === true
  );
};

export const usePWAPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => isPwaInstalled());

  const syncInstalled = useCallback(() => {
    const installed = isPwaInstalled();
    setIsInstalled(installed);
    if (installed) {
      setShowPrompt(false);
      setDeferredPrompt(null);
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

  const handleInstall = async () => {
    if (!deferredPrompt || isInstalled) return;

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
  };

  const handleDismiss = () => {
    setShowPrompt(false);
  };

  const canInstall = deferredPrompt !== null && !isInstalled;

  return {
    showPrompt: showPrompt && !isInstalled,
    canInstall,
    isInstalled,
    handleInstall,
    handleDismiss,
  };
};