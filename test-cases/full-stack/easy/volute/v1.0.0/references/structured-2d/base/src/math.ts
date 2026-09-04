// Volute — the two numeric helpers the whole build shares.

/** Clamp a value into a closed range. */
export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** An angle in degrees folded into `[0, 360)`. */
export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return ((degrees % 360) + 360) % 360;
}

/** Degrees to radians. */
export function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
