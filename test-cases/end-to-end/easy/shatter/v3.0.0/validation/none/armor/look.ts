// armor — how the two `presentation` checks in this group read a rock's own pixels.
//
// `specs/rocks.md` says a struck rock flashes and a damaged rock is drawn more
// damaged, and says NOTHING about how either is drawn: no colour, no crack, no
// outline. `specs/overview.md` leaves the whole look to the build. So neither check
// may compare the canvas against a value this file made up — each reads the SAME
// rock twice and compares the two readings, and what is fixed here is only WHERE
// the readings are taken.
//
// THE 441 SAMPLES, AND WHY THEY ARE POLAR. A rock is a disc of its collision
// radius, and a build may draw its damage anywhere on it — a darkened core, a
// cracked face, a broken outline. So the samples are laid on 21 concentric rings of
// 21 points, every one of them inside the rock's outline, reaching from its centre
// out to `0.976` of its radius: 441 readings that cover the whole body rather than
// a patch of it. The rings are staggered by half a step so the points do not fall
// into spokes.
//
// AND WHY POLAR MATTERS FOR THE FLASH. `specs/rocks.md` gives every rock a slow
// drawn rotation, which is cosmetic and which a check cannot switch off. A mean
// taken over complete rings is very nearly invariant under that rotation, so the
// flash check reads a brightening rather than a rock having turned.

import {
  colorDistance,
  luminance,
  type Harness,
  type Rgb,
  type RockView,
} from "../harness";
import { TAU } from "../constants";
import { wrap } from "../geometry";

/** Concentric rings of samples, from the centre outward. */
const RINGS = 21;

/** Samples around each ring. */
const SPOKES = 21;

/** How many readings one look is: `RINGS * SPOKES`. */
export const LOOK_SAMPLES = RINGS * SPOKES;

/** The points one look is read at: inside the rock's outline, all over it. */
export function lookPoints(rock: RockView): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let ring = 0; ring < RINGS; ring += 1) {
    const radius = (rock.radius * (ring + 0.5)) / RINGS;
    for (let spoke = 0; spoke < SPOKES; spoke += 1) {
      const theta = (TAU * (spoke + 0.5 * ring)) / SPOKES;
      points.push(
        wrap({
          x: rock.x + radius * Math.cos(theta),
          y: rock.y + radius * Math.sin(theta),
        }),
      );
    }
  }
  return points;
}

/**
 * What the build has painted over the rock as it stands now, at those points.
 *
 * The rock is re-read by the caller before every look, so the samples follow the
 * rock rather than the place it was posed: a rock left at rest still falls toward
 * the star, and a reading nailed to a fixed point would drift off it.
 */
export async function readLook(h: Harness, rock: RockView): Promise<Rgb[]> {
  const read = await h.pixels(lookPoints(rock));
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/** The mean brightness of a look, out of 255. */
export function meanLuminance(look: readonly Rgb[]): number {
  if (look.length === 0) return 0;
  let total = 0;
  for (const sample of look) total += luminance(sample);
  return total / look.length;
}

/** How many of the samples changed colour by more than `threshold`, of 441. */
export function changedSamples(
  before: readonly Rgb[],
  after: readonly Rgb[],
  threshold: number,
): number {
  let changed = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    const a = before[i];
    const b = after[i];
    if (a === undefined || b === undefined) continue;
    if (colorDistance(a, b) > threshold) changed += 1;
  }
  return changed;
}
