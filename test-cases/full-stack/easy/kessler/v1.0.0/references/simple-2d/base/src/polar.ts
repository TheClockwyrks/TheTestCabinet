// Kessler — the polar and vector helpers every angular rule reads by.
//
// The conventions are the ones `specs/field.md` fixes: the rotation formula
// mapping `(x, y)` to `(x cos a - y sin a, x sin a + y cos a)` with positive
// `a` toward `+theta`, wrap-aware angular offsets in `[-180, 180)`, and
// angular membership by center point with inclusive boundaries. Positions map
// through `specs/overview.md`'s mapping, `x = 500 + r cos(theta)` and
// `y = 500 + r sin(theta)` with `theta` in degrees.

import { CENTER } from "./figures";

/** A 2D vector or point in logical units. */
export interface Vec {
  readonly x: number;
  readonly y: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Normalizes an angle in degrees into `[0, 360)`. */
export function normalizeDeg(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/**
 * The wrap-aware angular offset `a - b` in degrees, taken in `[-180, 180)`.
 */
export function angularOffsetDeg(a: number, b: number): number {
  const raw = (a - b) % 360;
  if (raw < -180) return raw + 360;
  if (raw >= 180) return raw - 360;
  return raw;
}

/**
 * Whether `angle` is within `halfSpan` degrees of `center` by wrap-aware
 * circular distance, boundaries inclusive.
 */
export function withinArcDeg(
  angle: number,
  center: number,
  halfSpan: number,
): boolean {
  return Math.abs(angularOffsetDeg(angle, center)) <= halfSpan;
}

/** The outward unit radial at angle `deg`. */
export function radialAt(deg: number): Vec {
  const rad = deg * DEG_TO_RAD;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

/** The unit tangential at a radial `n`: `n` rotated by `+90` degrees. */
export function tangentialOf(n: Vec): Vec {
  return { x: -n.y, y: n.x };
}

/** Rotates `v` by `deg` degrees, positive toward `+theta`. */
export function rotateDeg(v: Vec, deg: number): Vec {
  const rad = deg * DEG_TO_RAD;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * The signed angle from `from` to `to` in degrees, positive when rotating
 * `from` toward `+theta` reaches `to`, in `(-180, 180]`.
 */
export function signedAngleDeg(from: Vec, to: Vec): number {
  const cross = from.x * to.y - from.y * to.x;
  const dot = from.x * to.x + from.y * to.y;
  return Math.atan2(cross, dot) * RAD_TO_DEG;
}

/** The dot product of two vectors. */
export function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y;
}

/** The length of a vector. */
export function lengthOf(v: Vec): number {
  return Math.hypot(v.x, v.y);
}

/** `v` scaled to length `speed`; the zero vector stays zero. */
export function scaledTo(v: Vec, speed: number): Vec {
  const len = lengthOf(v);
  if (len === 0) return { x: 0, y: 0 };
  const f = speed / len;
  return { x: v.x * f, y: v.y * f };
}

/** The stage point at radius `r` and angle `deg` from the stage center. */
export function pointAt(r: number, deg: number): Vec {
  const rad = deg * DEG_TO_RAD;
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
}

/** A stage point's polar figures: radius, and angle normalized to `[0, 360)`. */
export interface Polar {
  readonly r: number;
  readonly angleDeg: number;
}

/** The polar figures of the stage point `(x, y)`. */
export function polarOf(x: number, y: number): Polar {
  const dx = x - CENTER;
  const dy = y - CENTER;
  return {
    r: Math.hypot(dx, dy),
    angleDeg: normalizeDeg(Math.atan2(dy, dx) * RAD_TO_DEG),
  };
}
