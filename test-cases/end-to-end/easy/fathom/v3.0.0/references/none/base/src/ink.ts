// Fathom — the ink clouds the forager releases.
//
// A cloud stands where it was released, blinding the two light hunters that
// stand in it or look through it, and dissipates on its own (`specs/sensing.md`).
// Nothing swims slower for it, so the cloud's only effect is on sight.

import { INK_LIFE, INK_RADIUS } from "./constants";

export interface InkCloud {
  /** Where the cloud stands, fixed at the point it was released. */
  x: number;
  y: number;
  /** Its radius, in logical units. */
  radius: number;
  /** Seconds of life it has left. */
  remaining: number;
}

/** The distance from a point to the nearest point of a segment. */
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
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(
    0,
    Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared),
  );
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export class InkField {
  private clouds: InkCloud[] = [];

  /** Every cloud still standing, as the snapshot reports them. */
  get all(): readonly InkCloud[] {
    return this.clouds;
  }

  /** Release a cloud, centered where the forager stands. */
  release(x: number, y: number): void {
    this.clouds.push({ x, y, radius: INK_RADIUS, remaining: INK_LIFE });
  }

  /** Run every cloud down by `dt`, dropping the ones that have dissipated. */
  update(dt: number): void {
    for (const cloud of this.clouds) cloud.remaining -= dt;
    this.clouds = this.clouds.filter((cloud) => cloud.remaining > 0);
  }

  clear(): void {
    this.clouds = [];
  }

  /** Whether a point lies inside a cloud. */
  covers = (x: number, y: number): boolean =>
    this.clouds.some((c) => Math.hypot(x - c.x, y - c.y) <= c.radius);

  /** Whether the segment joining two points passes through a cloud. */
  crosses = (x1: number, y1: number, x2: number, y2: number): boolean =>
    this.clouds.some(
      (c) => segmentDistance(c.x, c.y, x1, y1, x2, y2) <= c.radius,
    );
}
