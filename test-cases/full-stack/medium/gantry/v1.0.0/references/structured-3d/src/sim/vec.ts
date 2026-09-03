// Vectors on the world frame `specs/world.md` defines: x and z horizontal, y
// up. A position is a plain triple so it is cheap to make and trivial to
// compare; nothing in the simulation mutates one.

/** A position, a direction, or a force, as `(x, y, z)`. */
export type Vec3 = readonly [number, number, number];

/** The horizontal `(x, z)` of a vertical line — the slew axis, for one. */
export type Axis2 = readonly [number, number];

export const vec3 = (x: number, y: number, z: number): Vec3 => [x, y, z];

export const ZERO: Vec3 = [0, 0, 0];

export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];

export const scale = (a: Vec3, s: number): Vec3 => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];

export const negate = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const length = (a: Vec3): number =>
  Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);

export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/**
 * The horizontal distance from a vertical axis to a point.
 */
export const radius = (p: Vec3, axis: Axis2): number =>
  Math.hypot(p[0] - axis[0], p[2] - axis[1]);

/**
 * The horizontal vector from a vertical axis to a point, as `specs/statics.md`
 * writes `r`.
 */
export const radial = (p: Vec3, axis: Axis2): Vec3 => [
  p[0] - axis[0],
  0,
  p[2] - axis[1],
];

/**
 * `k x r` with `k = (0, 1, 0)`, which `specs/statics.md` writes as the vector
 * `(r.z, 0, -r.x)`.
 */
export const crossUp = (r: Vec3): Vec3 => [r[2], 0, -r[0]];

/**
 * The rotation `specs/statics.md` fixes for an arm node: a turn about the
 * vertical line through `axis` by the angle whose cosine and sine are given,
 * so a positive angle carries `+x` toward `+z`.
 */
export function rotateAboutY(
  p: Vec3,
  axis: Axis2,
  cos: number,
  sin: number,
): Vec3 {
  const dx = p[0] - axis[0];
  const dz = p[2] - axis[1];
  return [axis[0] + dx * cos - dz * sin, p[1], axis[1] + dx * sin + dz * cos];
}

/** A lattice node's identity as a string, for the maps the solves build over. */
export const nodeKey = (p: Vec3): string => `${p[0]},${p[1]},${p[2]}`;

/** The inverse of `nodeKey`. */
export function parseNodeKey(key: string): Vec3 {
  const parts = key.split(",");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Degrees to radians. */
export const DEG = Math.PI / 180;
