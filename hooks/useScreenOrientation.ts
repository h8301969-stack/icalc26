import { useEffect } from 'react';
import { getDeviceClass } from '../utils/devicePreferences';

type LayoutMode = 'portrait' | 'landscape';

export const useScreenOrientation = (
  layoutMode: LayoutMode,
  layoutModeAuto: boolean,
  enabled: boolean
) => {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (getDeviceClass() !== 'mobile') return;

    type OrientationLock =
      | 'any'
      | 'natural'
      | 'landscape'
      | 'portrait'
      | 'portrait-primary'
      | 'portrait-secondary'
      | 'landscape-primary'
      | 'landscape-secondary';

    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: OrientationLock) => Promise<void>;
      unlock?: () => void;
    };

    if (!orientation?.lock) return;

    let cancelled = false;

    const apply = async () => {
      try {
        if (layoutModeAuto) {
          orientation.unlock?.();
          return;
        }
        if (layoutMode === 'landscape') {
          await orientation.lock('landscape');
        } else {
          await orientation.lock('portrait-primary');
        }
      } catch {
        // Orientation lock often requires fullscreen / native shell (Capacitor).
      }
    };

    if (!cancelled) void apply();

    return () => {
      cancelled = true;
      try {
        orientation.unlock?.();
      } catch {
        // ignore
      }
    };
  }, [layoutMode, layoutModeAuto, enabled]);
};