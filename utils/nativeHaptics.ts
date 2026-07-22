/**
 * Native haptics/vibration feedback
 * Uses Capacitor Haptics plugin for native vibration control
 * Enhanced alternative to web vibration API with more granular control
 */

import { Haptics, ImpactStyle } from '@capacitor/haptics';

export type HapticIntensity = 'light' | 'medium' | 'heavy';

/**
 * Trigger simple vibration
 */
export const vibrate = async (duration: number = 50): Promise<void> => {
  try {
    await Haptics.vibrate({ duration });
  } catch (error) {
    console.warn('Haptics not available:', error);
  }
};

/**
 * Trigger impact haptic (button press, selection)
 */
export const hapticImpact = async (intensity: HapticIntensity = 'medium'): Promise<void> => {
  try {
    const style: ImpactStyle = {
      light: ImpactStyle.Light,
      medium: ImpactStyle.Medium,
      heavy: ImpactStyle.Heavy
    }[intensity];

    await Haptics.impact({ style });
  } catch (error) {
    console.warn('Haptics not available:', error);
  }
};

/**
 * Trigger notification haptic (success, warning, error)
 */
export const hapticNotification = async (
  type: 'success' | 'warning' | 'error' = 'success'
): Promise<void> => {
  try {
    const notificationType = {
      success: 'SUCCESS',
      warning: 'WARNING',
      error: 'ERROR'
    }[type] as 'SUCCESS' | 'WARNING' | 'ERROR';

    await Haptics.notification({ type: notificationType });
  } catch (error) {
    console.warn('Haptics not available:', error);
  }
};

/**
 * Trigger selection haptic (subtle feedback)
 */
export const hapticSelection = async (): Promise<void> => {
  try {
    await Haptics.selectionStart();
  } catch (error) {
    console.warn('Haptics not available:', error);
  }
};

/**
 * Pattern: Double tap (confirm action)
 */
export const hapticDoubleTap = async (): Promise<void> => {
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
    await new Promise(resolve => setTimeout(resolve, 50));
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch (error) {
    console.warn('Haptics not available:', error);
  }
};

/**
 * Pattern: Success feedback
 */
export const hapticSuccess = async (): Promise<void> => {
  try {
    await Haptics.notification({ type: 'SUCCESS' });
  } catch (error) {
    console.warn('Haptics not available:', error);
  }
};

/**
 * Pattern: Error feedback
 */
export const hapticError = async (): Promise<void> => {
  try {
    await Haptics.notification({ type: 'ERROR' });
  } catch (error) {
    console.warn('Haptics not available:', error);
  }
};

/**
 * Pattern: Warning feedback
 */
export const hapticWarning = async (): Promise<void> => {
  try {
    await Haptics.notification({ type: 'WARNING' });
  } catch (error) {
    console.warn('Haptics not available:', error);
  }
};

/**
 * Check if haptics are available on device
 */
export const areHapticsAvailable = async (): Promise<boolean> => {
  try {
    // Try a light vibration test
    await Haptics.vibrate({ duration: 1 });
    return true;
  } catch {
    return false;
  }
};
