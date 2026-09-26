// Fathom — the ink cloud.
//
// A cloud stands where it was released, blinding the hunters that see
// (`specs/sensing.md`). A hunter is blinded while its own center is inside a
// cloud, or while the segment joining its center to the forager's passes within
// the cloud's radius of the cloud's center. Both are geometry, so both live
// here and are asked fresh each step rather than kept as a timer.

export interface InkCloud {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** The seconds of life it has left. */
  remaining: number;
}

/** How far a point lies from a segment. */
export function segmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  let along = length > 0 ? ((px - x1) * dx + (py - y1) * dy) / length : 0;
  along = Math.max(0, Math.min(1, along));
  return Math.hypot(px - (x1 + along * dx), py - (y1 + along * dy));
}

/** Whether a point stands inside any cloud. */
export function inkCovers(
  clouds: readonly InkCloud[],
  x: number,
  y: number,
): boolean {
  return clouds.some(
    (cloud) => Math.hypot(x - cloud.x, y - cloud.y) <= cloud.radius,
  );
}

/** Whether any cloud lies on the line between two points. */
export function inkBetween(
  clouds: readonly InkCloud[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean {
  return clouds.some(
    (cloud) =>
      segmentDistance(cloud.x, cloud.y, x1, y1, x2, y2) <= cloud.radius,
  );
}
