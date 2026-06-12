import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const usePWAPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if app is already installed (can be added to home screen)
    const checkIfInstalled = () => {
      // Check if running as standalone (installed PWA)
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isFullscreen = window.matchMedia('(display-mode: fullscreen)').matches;
      setIsInstalled(isStandalone || isFullscreen);
    };

    checkIfInstalled();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleBeforeInstallPrompt = (e: Event) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    const event = e as BeforeInstallPromptEvent;
    setDeferredPrompt(event);
    // Show prompt after a small delay on app load
    setTimeout(() => {
      if (!isInstalled) {
        setShowPrompt(true);
      }
    }, 1000);
  };

  const handleAppInstalled = () => {
    setIsInstalled(true);
    setShowPrompt(false);
    setDeferredPrompt(null);
    console.log('PWA was installed');
  };

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
        // Show prompt again on next app open
        setShowPrompt(false);
      }
      
      setDeferredPrompt(null);
    } catch (err) {
      console.error('Error handling install prompt:', err);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    // Prompt will show again on next app load
  };

  return {
    showPrompt,
    deferredPrompt: deferredPrompt !== null,
    isInstalled,
    handleInstall,
    handleDismiss,
  };
};
