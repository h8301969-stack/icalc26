/** Pack / box carton helpers for inventory stock. */

export const gcd = (a: number, b: number): number => {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
};

/**
 * Format unit count relative to units-per-box.
 * e.g. units=4, perBox=8 → "4 packs · 1/2 box"
 */
export const formatBoxQuantity = (
  units: number,
  unitsPerBox?: number | null
): string => {
  const u = Math.max(0, Number(units) || 0);
  const per = Number(unitsPerBox) || 0;
  if (per <= 0) {
    return `${u} unit${u === 1 ? '' : 's'}`;
  }
  const whole = Math.floor(u / per);
  const rem = u % per;
  const boxPart =
    rem === 0
      ? `${whole} box${whole === 1 ? '' : 'es'}`
      : (() => {
          const g = gcd(u, per);
          const num = u / g;
          const den = per / g;
          if (whole === 0) return `${num}/${den} box`;
          return `${whole} + ${rem}/${per} box`;
        })();
  return `${u} pack${u === 1 ? '' : 's'} · ${boxPart}`;
};

/** True when unit count is an exact half-box (or other simple fraction of a box). */
export const boxFractionLabel = (
  units: number,
  unitsPerBox?: number | null
): string | null => {
  const u = Math.max(0, Number(units) || 0);
  const per = Number(unitsPerBox) || 0;
  if (per <= 0 || u <= 0) return null;
  const g = gcd(u, per);
  const num = u / g;
  const den = per / g;
  if (den === 1) return `${num} box${num === 1 ? '' : 'es'}`;
  return `${num}/${den} box`;
};
