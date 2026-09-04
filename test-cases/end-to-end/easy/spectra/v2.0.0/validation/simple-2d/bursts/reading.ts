// bursts/reading — the readings this group's checks share.
//
// Only the `bursts` group holds one square of the canvas against another
// reading of the same square, so these live beside the checks that use them
// rather than in the shared harness next door. Like everything there they fix a
// READING alone and never a threshold: every distance, tolerance and bound a
// check asserts is stated in that check, derived from the figure `specs/` fixes
// for it.
//
// WHY A SQUARE IS ALWAYS HELD AGAINST ITSELF. `specs/overview.md` fixes no
// palette and `specs/field.md` puts a starfield behind the play field whose
// layout, motion and marks are the build's, so a region held against some other
// patch's colour would read a build's own stars as a burst. Held against a
// reading of the SAME square with the burst gone — or against the same square
// while a second burst plays — the field cancels and the only thing that can
// have moved is what the burst painted.

import { fail } from "../assert";
import {
  type BurstSnapshot,
  type Box,
  type Region,
  type SpectraSnapshot,
} from "../harness";

/** The square a burst of footprint `size` is played on, centred at `(x, y)`. */
export function footprintOf(x: number, y: number, size: number): Box {
  return { x: x - size / 2, y: y - size / 2, w: size, h: size };
}

/** The burst with that id, failing the check with the scenario it needed. */
export function burstOf(
  snapshot: SpectraSnapshot,
  id: number,
  doing = "the scenario",
): BurstSnapshot {
  const burst = snapshot.bursts.find((live) => live.id === id);
  if (burst === undefined) {
    fail(
      `burst ${id} still playing (${doing})`,
      `bursts ${JSON.stringify(snapshot.bursts.map((live) => live.id))}`,
    );
  }
  return burst;
}

/** Two readings of one square, or a failure naming the pair that disagreed. */
function samePixels(before: Region, after: Region): number {
  if (before.width !== after.width || before.height !== after.height) {
    fail(
      `two readings of the same square (${before.width}x${before.height})`,
      `${after.width}x${after.height}`,
    );
  }
  return before.width * before.height;
}

/** How far one place of a square moved between two readings of it, and where. */
export interface Departure {
  /** Euclidean RGB distance, out of the `441` an RGB cube is across. */
  distance: number;
  /** Where it moved, in logical units. */
  x: number;
  y: number;
}

/**
 * The pixel of a square that MOVED furthest between two readings of it, how far
 * it moved as a Euclidean RGB distance out of the `441` an RGB cube is across,
 * and where on the stage it sits.
 *
 * `box` is the logical square the two readings were taken over, so a pixel's
 * index maps back to the place it came from and a failure can name it.
 */
export function furthestChange(
  before: Region,
  after: Region,
  box: Box,
): Departure {
  samePixels(before, after);
  let found: Departure = { distance: -1, x: box.x, y: box.y };
  for (let at = 0; at < after.data.length; at += 4) {
    const distance = Math.hypot(
      after.data[at] - before.data[at],
      after.data[at + 1] - before.data[at + 1],
      after.data[at + 2] - before.data[at + 2],
    );
    if (distance <= found.distance) continue;
    const pixel = at / 4;
    const column = pixel % after.width;
    const row = (pixel - column) / after.width;
    found = {
      distance,
      x: box.x + (column / after.width) * box.w,
      y: box.y + (row / after.height) * box.h,
    };
  }
  return found;
}

/**
 * How many pixels of a square moved further than `minDistance` between two
 * readings of it.
 *
 * The count rather than the single furthest pixel, for a check asking whether
 * something was PAINTED over a stretch of field: one pixel can move because a
 * build's starfield drifted a mark under the reading, while a population of
 * particles moves a whole patch of them.
 */
export function changedPixels(
  before: Region,
  after: Region,
  minDistance: number,
): number {
  samePixels(before, after);
  let count = 0;
  for (let at = 0; at < after.data.length; at += 4) {
    const distance = Math.hypot(
      after.data[at] - before.data[at],
      after.data[at + 1] - before.data[at + 1],
      after.data[at + 2] - before.data[at + 2],
    );
    if (distance > minDistance) count += 1;
  }
  return count;
}

/**
 * How far two readings of one square stand apart on average, as a mean
 * Euclidean RGB distance per pixel out of the `441` an RGB cube is across.
 *
 * The mean rather than the furthest pixel, for a check asking whether two
 * pictures are the SAME picture: a single moved pixel is what one particle's
 * rounding does, while the mean over a whole square moves only if what was
 * painted over it landed somewhere else.
 */
export function meanChange(before: Region, after: Region): number {
  const pixels = samePixels(before, after);
  let total = 0;
  for (let at = 0; at < after.data.length; at += 4) {
    total += Math.hypot(
      after.data[at] - before.data[at],
      after.data[at + 1] - before.data[at + 1],
      after.data[at + 2] - before.data[at + 2],
    );
  }
  return total / pixels;
}
