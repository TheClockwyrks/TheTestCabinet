// Fathom — the ink cloud (`specs/sensing.md`).
//
// A cloud is a dark disc fixed where it was released, standing for its life and
// blinding the two hunters that see. It is plain data on the state; this module
// is the arithmetic over it and holds nothing.

import { INK_LIFE, INK_RADIUS } from "./constants";
import { segmentDistance } from "./grid";
import type { InkCloudState } from "./state";

/** A fresh cloud, centered where the forager released it. */
export function releaseInk(x: number, y: number): InkCloudState {
  return { x, y, radius: INK_RADIUS, remaining: INK_LIFE };
}

/** The clouds still standing after `dt` seconds. A spent cloud leaves the list. */
export function ageInk(
  clouds: readonly InkCloudState[],
  dt: number,
): readonly InkCloudState[] {
  const next: InkCloudState[] = [];
  for (const cloud of clouds) {
    const remaining = cloud.remaining - dt;
    if (remaining > 0) next.push({ ...cloud, remaining });
  }
  return next;
}

/** Whether `(x, y)` lies inside any cloud. */
export function inkCovers(
  clouds: readonly InkCloudState[],
  x: number,
  y: number,
): boolean {
  return clouds.some(
    (cloud) => Math.hypot(x - cloud.x, y - cloud.y) <= cloud.radius,
  );
}

/** Whether any cloud lies on the segment joining two points. */
export function inkCrosses(
  clouds: readonly InkCloudState[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  return clouds.some(
    (cloud) =>
      segmentDistance(cloud.x, cloud.y, ax, ay, bx, by) <= cloud.radius,
  );
}

/**
 * Whether ink blinds a hunter standing at `(px, py)` looking at the forager at
 * `(fx, fy)`: the hunter stands in a cloud, or a cloud lies on the line between
 * the two.
 */
export function inkBlinds(
  clouds: readonly InkCloudState[],
  px: number,
  py: number,
  fx: number,
  fy: number,
): boolean {
  return inkCovers(clouds, px, py) || inkCrosses(clouds, px, py, fx, fy);
}
