// bursts/reading — the three readings this group's checks share.
//
// Only the `bursts` group reads a roster and a region this way, so they live
// beside the checks that use them rather than in the shared harness next door.
// Like everything there they fix a READING alone — which burst a pop left, and
// which sample of a region moved — and never a threshold: every distance,
// tolerance and bound a check asserts is stated in that check, derived from the
// figure `specs/` fixes for it.
//
// WHY A BURST IS FOUND BY WHAT WAS NOT THERE BEFORE. `specs/instrumentation.md`
// makes appending the rule for an entity ADDED THROUGH THE SURFACE, so an id is
// findable without an assignment scheme — and there is no operation that adds a
// burst. A burst is an outcome, and the surface says only that the roster is
// reported "in roster order". So the burst a pop left is identified as the live
// burst carrying an id that was not live before it, which holds whatever order a
// build keeps its roster in.

import { fail } from "../assert";
import {
  colorDistance,
  type BurstView,
  type Rect,
  type Rgb,
  type SpectraSnapshot,
} from "../harness";

/** The burst with that id, failing the check with the scenario it needed. */
export function requireBurst(
  snapshot: SpectraSnapshot,
  id: number,
  doing = "the scenario",
): BurstView {
  const burst = snapshot.bursts.find((live) => live.id === id);
  if (burst === undefined) {
    fail(
      `burst ${id} still playing (${doing})`,
      `bursts ${JSON.stringify(snapshot.bursts.map((live) => live.id))}`,
    );
  }
  return burst;
}

/**
 * The one burst that is playing after `doing` and was not playing before it.
 *
 * Exactly one, because a pop starts one burst (`specs/assets.md`): a reading
 * that found none or found two has nothing to report a size or a placement off,
 * and says so as the precondition it is rather than picking one.
 */
export function poppedBurst(
  before: SpectraSnapshot,
  after: SpectraSnapshot,
  doing: string,
): BurstView {
  const had = new Set(before.bursts.map((burst) => burst.id));
  const added = after.bursts.filter((burst) => !had.has(burst.id));
  if (added.length !== 1) {
    fail(
      `exactly one burst playing after ${doing} that was not playing before it`,
      `${added.length} (bursts ${JSON.stringify(
        after.bursts.map((burst) => burst.id),
      )} against ${JSON.stringify([...had])})`,
    );
  }
  return added[0];
}

/** How far one place of a region moved between two readings of it, and where. */
export interface Departure {
  distance: number;
  x: number;
  y: number;
}

/**
 * The sample of a region that MOVED furthest between two readings of it, and how
 * far it moved, as a Euclidean RGB distance out of the `441` an RGB cube is
 * across.
 *
 * The reading for a check asking whether something was PAINTED where the game
 * says it is, without asking what colour or shape the build painted it in.
 * `specs/overview.md` fixes no palette and `specs/field.md` puts a starfield
 * behind the play field, so a region held against some other patch's colour
 * would read a build's own stars as a burst. Held against ITSELF on a reading of
 * the same region with the burst gone, the only thing that can move is what the
 * burst painted.
 *
 * The lattice is {@link readRegion}'s: `rect` and `step` are the ones the two
 * readings were taken with, so a sample's index maps back to the place it came
 * from and a failure can name it.
 */
export function furthestChange(
  before: readonly Rgb[],
  after: readonly Rgb[],
  rect: Rect,
  step: number,
): Departure {
  if (before.length !== after.length) {
    fail(
      `two readings of the same region (${before.length} samples)`,
      `${after.length} samples`,
    );
  }
  const stride = Math.max(1, step);
  const columns = Math.max(1, Math.ceil(rect.width / stride));
  let found: Departure = { distance: -1, x: rect.x, y: rect.y };
  for (let index = 0; index < after.length; index += 1) {
    const distance = colorDistance(before[index], after[index]);
    if (distance <= found.distance) continue;
    const column = index % columns;
    const row = (index - column) / columns;
    found = {
      distance,
      x: rect.x + column * stride,
      y: rect.y + row * stride,
    };
  }
  return found;
}

/**
 * How many samples of a region moved further than `minDistance` between two
 * readings of it.
 *
 * The count rather than the single furthest sample, for a check asking whether
 * something was PAINTED over a stretch of field: one sample can move because a
 * build's starfield drifted a mark under the reading, while a population of
 * particles moves a whole patch of them.
 *
 * The lattice is {@link readRegion}'s, and the two readings must have been taken
 * on the same one — a pair of different lengths is not comparable and says so
 * rather than quietly counting the shorter.
 */
export function changedSamples(
  before: readonly Rgb[],
  after: readonly Rgb[],
  minDistance: number,
): number {
  if (before.length !== after.length) {
    fail(
      `two readings of the same region (${before.length} samples)`,
      `${after.length} samples`,
    );
  }
  let moved = 0;
  for (let index = 0; index < after.length; index += 1) {
    if (colorDistance(before[index], after[index]) > minDistance) moved += 1;
  }
  return moved;
}
