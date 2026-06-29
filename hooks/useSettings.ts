import { useState, useEffect, useCallback } from 'react';
import { THEMES, WALLPAPER_SLIDES } from '../constants';
import { storage } from './storage';

const SETTINGS_KEY = 'calc_settings';

const DEFAULTS = {
  accentColor: THEMES[0].color,
  glassBlur: 24,
  hapticFeedback: true,
  hapticIntensity: 'medium' as 'soft' | 'medium' | 'intense',
  themeMode: 'light' as 'light' | 'dark',
  currency: 'GHS' as 'GHS' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'NGN',
  customWallpapers: WALLPAPER_SLIDES,
  uiScale: 1,
  disableCalculatorCard: false as boolean,
  layoutMode: 'portrait' as 'portrait' | 'landscape',
};

export const useSettings = () => {
  const [settings, setSettings] = useState<typeof DEFAULTS>(() => ({
    ...DEFAULTS,
    ...storage.get(SETTINGS_KEY, DEFAULTS),
  }));

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
    const duration = settings.hapticIntensity === 'soft' ? 5 : settings.hapticIntensity === 'medium' ? 15 : 30;
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