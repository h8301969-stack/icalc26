/**
 * Lightweight UI sounds (Web Audio) — no asset files.
 * Click: short tick. Swipe: soft whoosh.
 * Respects Settings → Sound effects toggle.
 */

let ctx: AudioContext | null = null;
let soundsEnabled = true;
let hapticsEnabled = true;

export const setUiSoundsEnabled = (enabled: boolean): void => {
  soundsEnabled = enabled;
};

export const setUiHapticsEnabled = (enabled: boolean): void => {
  hapticsEnabled = enabled;
};

export const getUiSoundsEnabled = (): boolean => soundsEnabled;
export const getUiHapticsEnabled = (): boolean => hapticsEnabled;

const getCtx = (): AudioContext | null => {
  if (typeof window === 'undefined' || !soundsEnabled) return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
};

const tone = (
  frequency: number,
  duration: number,
  type: OscillatorType,
  gainPeak: number,
  opts?: { slideTo?: number; delay?: number }
) => {
  if (!soundsEnabled) return;
  const audio = getCtx();
  if (!audio) return;
  const t0 = audio.currentTime + (opts?.delay ?? 0);
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t0);
  if (opts?.slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.slideTo), t0 + duration);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
};

/** Short UI click / tap. */
export const playClickSound = (): void => {
  if (!soundsEnabled) return;
  tone(920, 0.045, 'triangle', 0.09);
  tone(1380, 0.03, 'sine', 0.04, { delay: 0.008 });
};

/** Soft swipe / unlock whoosh. */
export const playSwipeSound = (): void => {
  if (!soundsEnabled) return;
  tone(280, 0.12, 'sine', 0.07, { slideTo: 520 });
  tone(180, 0.14, 'triangle', 0.045, { slideTo: 90, delay: 0.02 });
};

/** Idle unlock: click + light whoosh together. */
export const playUnlockSound = (): void => {
  if (!soundsEnabled) return;
  playClickSound();
  playSwipeSound();
};

/** Shared haptic that respects Settings → Haptics. */
export const playHaptic = (pattern: number | number[] = 15): void => {
  if (!hapticsEnabled || typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
};

/** Warm AudioContext on first user gesture (call from pointerdown). */
export const primeUiAudio = (): void => {
  if (!soundsEnabled) return;
  getCtx();
};
