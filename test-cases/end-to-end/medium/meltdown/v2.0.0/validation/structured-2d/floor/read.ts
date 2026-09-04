// floor — the readings this group takes that the shared harness does not offer.
//
// Two kinds, and both are READINGS rather than thresholds: how a single device
// pixel is read off the canvas, and how a roster row this group posed is named
// when the build has lost it. Every figure a check asserts stays in the check
// that asserts it.
//
// WHY RAW PIXELS AND NOT `sampleColor`. The harness's `sampleColor` averages a
// five-point cluster three units either side of its centre, which is exactly
// right for "what colour is this tower" and exactly wrong for every geometric
// reading in this group: the casing band is eighteen units thick, a grid line is
// one unit wide, and a footprint's edge is the thing being located. A cluster six
// units across blurs all three. So the geometric checks read SINGLE pixels and
// say, in their own terms, how far the boundary they found may sit from the one
// `specs/floor.md` fixes.
//
// WHY IT IS LOCAL TO THIS GROUP. Nothing here is a threshold and nothing here is
// a scenario: it is the single-pixel read, the rendering of a colour for a
// failure message, and the two strict roster readers. No other group in this
// suite measures a distance on the stage, so a helper in `harness.ts` would be a
// helper seventeen groups could not use.

import { fail } from "../assert";
import type {
  Harness,
  MeltdownSnapshot,
  Point,
  Rgb,
  TowerSnapshot,
  UnitSnapshot,
} from "../harness";
import { towerById, unitById } from "../harness";

/**
 * The one device pixel under a logical stage point.
 *
 * The point is mapped through the engine's own fit, so a reading is taken where
 * `specs/floor.md` says the thing should be rather than wherever the canvas
 * happens to be that many pixels along.
 */
export function pixelAt(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** {@link pixelAt} over a run of points, in order. */
export function pixelsAt(h: Harness, points: readonly Point[]): Rgb[] {
  return points.map((point) => pixelAt(h, point.x, point.y));
}

/** A colour, rendered for a failure message. */
export function showRgb(c: Rgb): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}

/**
 * The unit carrying `id`, or a failure saying the roster no longer holds it.
 *
 * A check that posed a unit and then found it gone has found a different failure
 * from whatever it went on to read, so it is named as one here rather than
 * surfacing as a reading taken off `undefined`.
 */
export function unitOf(snapshot: MeltdownSnapshot, id: number): UnitSnapshot {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    return fail(
      `a unit with id ${id} on the floor (specs/instrumentation.md, Identity)`,
      snapshot.surge.map((entry) => entry.id),
    );
  }
  return unit;
}

/** Whether the roster still holds a unit carrying `id`. */
export function hasUnit(snapshot: MeltdownSnapshot, id: number): boolean {
  return unitById(snapshot, id) !== undefined;
}

/**
 * The tower carrying `id`, or a failure saying the roster no longer holds it.
 *
 * The companion of {@link unitOf}, and it is here for the same reason: a check
 * that posed a tower and then found it gone has found a different failure from
 * whatever it went on to read.
 */
export function towerOf(snapshot: MeltdownSnapshot, id: number): TowerSnapshot {
  const tower = towerById(snapshot, id);
  if (tower === undefined) {
    return fail(
      `a tower with id ${id} on the floor (specs/instrumentation.md, Identity)`,
      snapshot.towers.map((entry) => entry.id),
    );
  }
  return tower;
}
