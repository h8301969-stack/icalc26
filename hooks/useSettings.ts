import { useState, useEffect, useCallback, useMemo } from 'react';
import { THEMES, WALLPAPER_SLIDES } from '../constants';
import { storage } from './storage';
import { UserProfile } from '../types';

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
  profiles: [] as UserProfile[],
  activeProfileId: '',
};

const migrateStoredSettings = (stored: Partial<typeof DEFAULTS> & Record<string, unknown>): typeof DEFAULTS => {
  const merged = { ...DEFAULTS, ...stored } as typeof DEFAULTS & Record<string, unknown>;

  if (!merged.profiles?.length) {
    const legacyName =
      (typeof merged.profileName === 'string' && merged.profileName) ||
      (typeof merged.businessName === 'string' && merged.businessName) ||
      'fred';
    const defaultProfile: UserProfile = {
      id: `profile-${Date.now()}`,
      name: legacyName,
      avatarUrl: '',
    };
    return {
      ...merged,
      profiles: [defaultProfile],
      activeProfileId: defaultProfile.id,
    };
  }

  if (!merged.activeProfileId && merged.profiles.length > 0) {
    return { ...merged, activeProfileId: merged.profiles[0].id };
  }

  return merged as typeof DEFAULTS;
};

export const useSettings = () => {
  const [settings, setSettings] = useState<typeof DEFAULTS>(() =>
    migrateStoredSettings(storage.get(SETTINGS_KEY, DEFAULTS))
  );

  useEffect(() => {
    storage.set(SETTINGS_KEY, settings);
    document.documentElement.style.fontSize = `${(settings.uiScale || 1) * 100}%`;
  }, [settings]);

  const updateSettings = useCallback((updates: Partial<typeof settings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const activeProfile = useMemo(
    () => settings.profiles.find((p) => p.id === settings.activeProfileId) ?? settings.profiles[0] ?? null,
    [settings.profiles, settings.activeProfileId]
  );

  const setActiveProfile = useCallback((profileId: string) => {
    setSettings((prev) => ({ ...prev, activeProfileId: profileId }));
  }, []);

  const addProfile = useCallback((name: string, avatarUrl = '') => {
    const profile: UserProfile = {
      id: `profile-${Date.now()}`,
      name: name.trim(),
      avatarUrl,
    };
    setSettings((prev) => ({
      ...prev,
      profiles: [...prev.profiles, profile],
      activeProfileId: profile.id,
    }));
    return profile.id;
  }, []);

  const updateProfile = useCallback((profileId: string, updates: Partial<Pick<UserProfile, 'name' | 'avatarUrl'>>) => {
    setSettings((prev) => ({
      ...prev,
      profiles: prev.profiles.map((p) =>
        p.id === profileId ? { ...p, ...updates } : p
      ),
    }));
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
    formatCurrency,
    activeProfile,
    setActiveProfile,
    addProfile,
    updateProfile,
  };
};