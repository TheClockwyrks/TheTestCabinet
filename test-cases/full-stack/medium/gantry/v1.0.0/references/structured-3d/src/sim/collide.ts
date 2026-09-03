// The one obstacle rule of `specs/world.md`: a body meets an obstacle only
// where it reaches inside the box, STRICTLY between the box's minimum and its
// maximum on all three axes. Contact is not collision, so a segment grazing a
// face, a segment lying flush along one, and a box resting flush against one
// are all clear of it. Every obstacle test in the game reads this file.

import { DEG, sub, type Vec3 } from "./vec";
import type { Box } from "./types";

/** Below this the segment is parallel to the slab and is tested as a point. */
const PARALLEL_EPS = 1e-12;

/**
 * Whether the segment `p`-`q` reaches strictly inside the box.
 *
 * The slab clip keeps the OPEN interval: an entry parameter at or past the exit
 * parameter leaves no interior stretch, so a segment lying in a face plane, or
 * touching one at a single point, is clear.
 */
export function segmentInsideBox(p: Vec3, q: Vec3, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = sub(q, p);
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < PARALLEL_EPS) {
      // Parallel to this pair of faces: the whole segment is inside the slab
      // only where its own coordinate is strictly between them.
      if (p[i] <= box.min[i] || p[i] >= box.max[i]) return false;
    } else {
      let a = (box.min[i] - p[i]) / d[i];
      let b = (box.max[i] - p[i]) / d[i];
      if (a > b) {
        const swap = a;
        a = b;
        b = swap;
      }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 >= t1) return false;
    }
  }
  return true;
}

/**
 * Whether a yawed box reaches strictly inside an axis-aligned one. `center` is
 * the yawed box's center, `half` its half extents at yaw `0`, and `yaw` its
 * rotation about the vertical in degrees.
 *
 * The vertical axis separates on its own; the horizontal pair is a rectangle
 * against a rectangle, which the four face normals decide. Every test is "at
 * or past", so touching separates and is clear.
 */
export function yawedBoxInsideBox(
  center: Vec3,
  yaw: number,
  half: Vec3,
  box: Box,
): boolean {
  if (center[1] + half[1] <= box.min[1] || center[1] - half[1] >= box.max[1]) {
    return false;
  }
  const cos = Math.cos(yaw * DEG);
  const sin = Math.sin(yaw * DEG);
  // The yawed box's local +x and +z in the world's horizontal plane.
  const ex: readonly [number, number] = [cos, sin];
  const ez: readonly [number, number] = [-sin, cos];
  const boxCenter: readonly [number, number] = [
    (box.min[0] + box.max[0]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
  const boxHalf: readonly [number, number] = [
    (box.max[0] - box.min[0]) / 2,
    (box.max[2] - box.min[2]) / 2,
  ];
  const delta: readonly [number, number] = [
    center[0] - boxCenter[0],
    center[2] - boxCenter[1],
  ];
  const axes: readonly (readonly [number, number])[] = [[1, 0], [0, 1], ex, ez];
  for (const axis of axes) {
    const projected =
      Math.abs(half[0] * (ex[0] * axis[0] + ex[1] * axis[1])) +
      Math.abs(half[2] * (ez[0] * axis[0] + ez[1] * axis[1]));
    const projectedBox =
      Math.abs(boxHalf[0] * axis[0]) + Math.abs(boxHalf[1] * axis[1]);
    if (
      Math.abs(delta[0] * axis[0] + delta[1] * axis[1]) >=
      projected + projectedBox
    ) {
      return false;
    }
  }
  return true;
}

/** Whether a member's segment reaches inside any of the site's obstacles. */
export function segmentStrikesAny(
  p: Vec3,
  q: Vec3,
  obstacles: readonly Box[],
): boolean {
  for (const box of obstacles) if (segmentInsideBox(p, q, box)) return true;
  return false;
}

/**
 * Whether a carried load's box reaches inside any obstacle. `lift` is the
 * load's lift point, the center of its top face (`specs/world.md`), so the box
 * hangs its full height below it.
 */
export function loadStrikesAny(
  lift: Vec3,
  yaw: number,
  half: Vec3,
  obstacles: readonly Box[],
): boolean {
  const center: Vec3 = [lift[0], lift[1] - half[1], lift[2]];
  for (const box of obstacles) {
    if (yawedBoxInsideBox(center, yaw, half, box)) return true;
  }
  return false;
}

/**
 * Whether a carried load dips below the ground: its lift point's `y` minus its
 * class height falling below `0`. A load whose bottom face rests exactly on
 * `y = 0` is on the ground, not through it.
 */
export function loadBelowGround(lift: Vec3, height: number): boolean {
  return lift[1] - height < 0;
}
