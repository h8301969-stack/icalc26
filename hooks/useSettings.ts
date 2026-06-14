import { useState, useEffect, useCallback } from 'react';
import { THEMES } from '../constants';
import { storage } from './storage';

// Import local images to replace external links
import pos1 from '@/assets/autoswipe/pos1.png';
import pos2 from '@/assets/autoswipe/pos2.png';
import pos3 from '@/assets/autoswipe/pos3.png';
import pos4 from '@/assets/autoswipe/pos4.png';
import pos5 from '@/assets/autoswipe/pos5.png';
import pos6 from '@/assets/autoswipe/pos6.png';

const LOCAL_WALLPAPERS = [pos1, pos2, pos3, pos4, pos5, pos6];
export { LOCAL_WALLPAPERS }; // Export for use in Settings UI components

const SETTINGS_KEY = 'calc_settings';

const DEFAULTS = {
  accentColor: THEMES[0].color,
  glassBlur: 24,
  hapticFeedback: true,
  hapticIntensity: 'medium' as 'soft' | 'medium' | 'intense',
  themeMode: 'light' as 'light' | 'dark',
  currency: 'GHS' as 'GHS' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'NGN',
  customWallpapers: LOCAL_WALLPAPERS,
  uiScale: 1
};

export const useSettings = () => {
  const [settings, setSettings] = useState<typeof DEFAULTS>(() => storage.get(SETTINGS_KEY, DEFAULTS));

  useEffect(() => {
    storage.set(SETTINGS_KEY, settings);
    document.documentElement.style.fontSize = `${(settings.uiScale || 1) * 100}%`;
  }, [settings]);

  const updateSettings = useCallback((updates: Partial<typeof settings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const formatCurrency = useCallback((valStr: string) => {
    const num = parseFloat(valStr) || 0;
    const val = num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const symbols: Record<string, string> = { GHS: `${val}ghs`, USD: `$${val}`, EUR: `€${val}`, GBP: `£${val}`, JPY: `¥${val}`, NGN: `₦${val}` };
    return symbols[settings.currency] || val;
  }, [settings.currency]);

  const triggerHaptic = useCallback((multiplier: number = 1) => {
    if (!settings.hapticFeedback || !('vibrate' in navigator)) return;
    let duration = settings.hapticIntensity === 'soft' ? 5 : settings.hapticIntensity === 'medium' ? 15 : 30;
    navigator.vibrate(duration * multiplier);
  }, [settings.hapticFeedback, settings.hapticIntensity]);

  return { 
    settings, 
    updateSettings, 
    triggerHaptic,
    isLight: settings.themeMode === 'light',
    formatCurrency
  };
};