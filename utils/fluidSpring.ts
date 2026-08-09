/**
 * Apple-style fluid spring + rubber-band math for web.
 * Mirrors react-native-reanimated withSpring critical-damping feel:
 * high stiffness, moderate damping, optional overshoot, interruptible.
 */

export type SpringConfig = {
  mass: number;
  damping: number;
  stiffness: number;
  overshootClamping: boolean;
  restSpeed: number;
  restDisplacement: number;
};

/**
 * iOS fluid settle — snappier for 120Hz (ProMotion).
 * Higher stiffness + slightly lower mass = faster settle matching 280ms UI pops.
 */
export const APPLE_FLUID_SPRING: SpringConfig = {
  mass: 0.7,
  damping: 30,
  stiffness: 320,
  overshootClamping: false,
  restSpeed: 0.03,
  restDisplacement: 0.002,
};

export const defaultSpring = (partial?: Partial<SpringConfig>): SpringConfig => ({
  ...APPLE_FLUID_SPRING,
  ...partial,
});

/**
 * UIKit-style rubber-band when past bounds.
 * `dimension` is the scale of resistance (use 1 for index units).
 */
export function rubberBand(
  offset: number,
  min: number,
  max: number,
  dimension: number,
  constant = 0.55
): number {
  const dim = Math.max(dimension, 0.001);
  if (offset < min) {
    const over = min - offset;
    return min - (1 - 1 / ((over * constant) / dim + 1)) * dim * constant;
  }
  if (offset > max) {
    const over = offset - max;
    return max + (1 - 1 / ((over * constant) / dim + 1)) * dim * constant;
  }
  return offset;
}

export type SpringHandle = {
  stop: () => void;
  readonly active: boolean;
};

/**
 * Spring animate `from` → `to`.
 * Velocity is in units/ms (same units as `from`/`to` per millisecond).
 */
export function animateSpring(
  from: number,
  to: number,
  velocity: number,
  onFrame: (value: number, velocity: number) => void,
  onComplete?: (value: number) => void,
  config: Partial<SpringConfig> = {}
): SpringHandle {
  const cfg = defaultSpring(config);
  let x = from;
  let v = velocity;
  let raf = 0;
  let last = performance.now();
  let running = true;

  const tick = (now: number) => {
    if (!running) return;
    const dt = Math.min(32, Math.max(4, now - last));
    last = now;

    const displacement = x - to;
    // Map reanimated-like stiffness/damping into per-ms integration
    const springF = -cfg.stiffness * displacement;
    const dampF = -cfg.damping * (v * 1000);
    const a = (springF + dampF) / cfg.mass / 1000;

    v += a * dt;
    x += v * dt;

    if (cfg.overshootClamping) {
      if (from < to && x > to) {
        x = to;
        v = 0;
      } else if (from > to && x < to) {
        x = to;
        v = 0;
      }
    }

    const settled =
      Math.abs(v) < cfg.restSpeed / 1000 && Math.abs(x - to) < cfg.restDisplacement;

    if (settled) {
      x = to;
      v = 0;
      onFrame(x, v);
      running = false;
      onComplete?.(x);
      return;
    }

    onFrame(x, v);
    raf = requestAnimationFrame(tick);
  };

  onFrame(x, v);
  raf = requestAnimationFrame(tick);

  return {
    get active() {
      return running;
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/**
 * Intent-based target index from continuous position + release velocity.
 * velocityPerMs is d(position)/dt in index-units per ms:
 *   negative → toward lower indices (previous card)
 *   positive → toward higher indices (next card)
 */
export function pickCarouselIndex(
  position: number,
  velocityPerMs: number,
  min: number,
  max: number
): number {
  const fling = 0.0011; // ~1.1 cards/s
  const distanceThreshold = 0.28;
  const projected = position + velocityPerMs * 160;

  let target: number;

  if (velocityPerMs > fling) {
    // Fling to next — leave current page at least one step
    const currentPage = Math.round(position);
    target = Math.max(currentPage + 1, Math.round(projected));
  } else if (velocityPerMs < -fling) {
    // Fling to previous
    const currentPage = Math.round(position);
    target = Math.min(currentPage - 1, Math.round(projected));
  } else {
    const nearest = Math.round(position);
    const delta = projected - nearest;
    if (Math.abs(delta) < distanceThreshold && Math.abs(position - nearest) < distanceThreshold) {
      target = nearest;
    } else if (projected >= nearest + distanceThreshold || position >= nearest + distanceThreshold) {
      target = nearest + 1;
    } else if (projected <= nearest - distanceThreshold || position <= nearest - distanceThreshold) {
      target = nearest - 1;
    } else {
      target = nearest;
    }
  }

  return Math.max(min, Math.min(max, target));
}
