import { useState, useEffect, useCallback, useMemo } from 'react';
import { THEMES, WALLPAPER_SLIDES } from '../constants';
import { migrateWallpaperSlides } from '../utils/wallpapers';
import { getAutoLayoutMode, getSystemTheme, ThemeMode } from '../utils/devicePreferences';
import { storage } from './storage';
import { UserProfile } from '../types';
import { ensureAdminProfile } from '../utils/auth';
import { ExpressionViewMode, normalizeExpressionViewMode } from '../utils/expressionDisplay';
import { ReceiptLayoutMode } from '../utils/receiptLayout';

const SETTINGS_KEY = 'calc_settings';

const DEFAULTS = {
  accentColor: THEMES[0].color,
  glassBlur: 24,
  hapticFeedback: true,
  hapticIntensity: 'medium' as 'soft' | 'medium' | 'intense',
  themeMode: 'system' as ThemeMode,
  currency: 'GHS' as 'GHS' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'NGN',
  customWallpapers: WALLPAPER_SLIDES,
  uiScale: 1,
  disableCalculatorCard: false as boolean,
  layoutMode: 'portrait' as 'portrait' | 'landscape',
  layoutModeAuto: true,
  invoiceSwitcherMode: 'horizontal' as 'horizontal' | 'grid' | 'vertical' | 'list',
  expressionViewMode: 'auto' as ExpressionViewMode,
  receiptLayoutMode: 'summary' as ReceiptLayoutMode,
  standbyTimerSeconds: 0,
  profiles: [] as UserProfile[],
  activeProfileId: '',
};

const migrateStoredSettings = (stored: Partial<typeof DEFAULTS> & Record<string, unknown>): typeof DEFAULTS => {
  const merged = { ...DEFAULTS, ...stored } as typeof DEFAULTS & Record<string, unknown>;
  merged.expressionViewMode = normalizeExpressionViewMode(
    merged.expressionViewMode as string | undefined
  );

  const storedLayout = merged.receiptLayoutMode as string | undefined;
  const hadLegacyShareToggles =
    'shareShowInvoiceName' in stored ||
    'shareShowTotal' in stored ||
    'shareShowAttendant' in stored;
  if (storedLayout === 'full' || storedLayout === 'summary') {
    merged.receiptLayoutMode = storedLayout;
  } else if (hadLegacyShareToggles) {
    merged.receiptLayoutMode = 'summary';
  }

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
    merged.activeProfileId = merged.profiles[0].id;
  }

  merged.profiles = ensureAdminProfile(merged.profiles ?? []);

  merged.customWallpapers = migrateWallpaperSlides(merged.customWallpapers);

  if (merged.layoutModeAuto !== false) {
    merged.layoutModeAuto = true;
    merged.layoutMode = getAutoLayoutMode();
  }

  delete merged.invoiceSwitcherGridCols;
  delete merged.invoiceSwitcherGridDensity;

  return merged as typeof DEFAULTS;
};

export const useSettings = () => {
  const [settings, setSettings] = useState<typeof DEFAULTS>(() =>
    migrateStoredSettings(storage.get(SETTINGS_KEY, DEFAULTS))
  );
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);

  useEffect(() => {
    storage.set(SETTINGS_KEY, settings);
    document.documentElement.style.fontSize = `${(settings.uiScale || 1) * 100}%`;
  }, [settings]);

  useEffect(() => {
    const resolved = settings.themeMode === 'system' ? systemTheme : settings.themeMode;
    document.documentElement.style.colorScheme = resolved;
  }, [settings.themeMode, systemTheme]);

  useEffect(() => {
    const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
    const onThemeChange = () => setSystemTheme(getSystemTheme());
    darkMq.addEventListener('change', onThemeChange);
    return () => darkMq.removeEventListener('change', onThemeChange);
  }, []);

  useEffect(() => {
    const syncLayout = () => {
      setSettings((prev) => {
        if (!prev.layoutModeAuto) return prev;
        const next = getAutoLayoutMode();
        return next === prev.layoutMode ? prev : { ...prev, layoutMode: next };
      });
    };

    const portraitMq = window.matchMedia('(orientation: portrait)');
    portraitMq.addEventListener('change', syncLayout);
    window.addEventListener('resize', syncLayout);
    syncLayout();

    return () => {
      portraitMq.removeEventListener('change', syncLayout);
      window.removeEventListener('resize', syncLayout);
    };
  }, []);

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

  const isLight = useMemo(
    () => (settings.themeMode === 'system' ? systemTheme : settings.themeMode) === 'light',
    [settings.themeMode, systemTheme]
  );

  return {
    settings,
    updateSettings,
    triggerHaptic,
    isLight,
    formatCurrency,
    activeProfile,
    setActiveProfile,
    addProfile,
    updateProfile,
  };
};