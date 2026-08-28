// lanternjaw/motes — reading an amber light off the rendered frame.
//
// Shared by the two Lanternjaw points that read pixels: `bulb-visible`, which asks
// whether the bulb is drawn where nothing else is, and `additive-reveal`, which
// asks whether lighting the creature leaves the bulb where it was. Both phrase the
// reading the same way, so the phrasing lives here and each check states its own
// thresholds against it.
//
// WHAT COUNTS AS WARM. specs/overview.md gives the two amber lights one reading:
// "each drawn as a warm amber light, red-leaning and clearly warmer than the
// water, the rock, and the forager's own light". The review item states the same
// test in channels: "with its red channel above its blue". That is the whole
// predicate here — a HUE test and nothing more — because no figure anywhere fixes
// how bright an amber mote is or how fast its glow falls off, so a threshold on
// brightness would fail a build that draws a dimmer light than the reference and
// satisfies every stated requirement. HOW MUCH brighter than its surroundings a
// mote must read is each check's to state, against a fog sample it took itself.

import {
  MOTE_RADII,
  MOTE_SEARCH,
  isWarm,
  luminance,
  sampleRing,
} from "../harness";
import type { Harness, MoteSample } from "../harness";

// "Red-leaning", the item's own test — "its red channel above its blue" — is the
// harness's `isWarm`, the one predicate every reading of an amber light in the
// suite asks. Re-exported so the two Lanternjaw points name it beside the rest of
// their mote reading.
export { isWarm as warm } from "../harness";

/**
 * The brightest WARM sample of a mote's profile, or `null` when none of it reads
 * warm at all.
 *
 * "The brightest warm pixel found within 12 units of its reported center" is the
 * item's own phrasing, and the two halves of it matter separately. Brightest,
 * because an amber core is the brightest thing in a dark trench and a check that
 * settled for the dim outer halo would measure the glow's falloff rather than the
 * light. Warm, because that core blows out toward white on a build that draws it
 * hot, and taking the brightest sample without regard to hue would read that
 * blow-out as neutral and call an unmistakable amber mote cold.
 */
export function brightestWarm(
  profile: readonly MoteSample[],
): MoteSample | null {
  let best: MoteSample | null = null;
  for (const sample of profile) {
    if (!isWarm(sample.color)) continue;
    if (best === null || luminance(sample.color) > luminance(best.color)) {
      best = sample;
    }
  }
  return best;
}

/** How finely the neighborhood is walked when the mote's center is measured. */
const CENTER_STEP = 2;

/**
 * How bright a sample must be, as a fraction of the brightest in the
 * neighborhood, to count as part of the mote's core.
 */
const CORE_FRACTION = 0.9;

/**
 * WHERE the mote is drawn: the luminance-weighted center of the brightest
 * not-cool region within {@link MOTE_SEARCH} of `(x, y)`.
 *
 * WHY NOT THE HARNESS'S OWN SEARCH. `findMote` answers a different question —
 * which lattice point to read a profile about — and it walks the neighborhood in
 * six-unit steps, so the answer it gives can only ever move in six-unit jumps.
 * `additive-reveal` bounds how far the mote may move at FOUR units, which is finer
 * than that grid: two frames of a build that never moved its bulb by a pixel can
 * still land on different lattice points, because an amber core saturates toward
 * white and a plateau of equal-brightest samples is resolved by whichever the scan
 * reached first. Lighting the creature widens that plateau, and the tie moves.
 *
 * A center of mass has no such tie. Every sample of the core is weighted by how
 * bright it is, so the answer sits between the lattice points rather than on one,
 * a symmetric mote reads at its own middle whatever the grid, and a mote a build
 * genuinely moved moves the answer by exactly as far as it moved the light. Cool
 * samples are dropped, so the trench and the forager's own glow cannot pull it;
 * the near-white core is kept, because that IS the light.
 *
 * Falls back to `(x, y)` when the neighborhood holds nothing that is not cool, so
 * a build that draws no mote at all is read exactly where it should have drawn one.
 */
export function moteCenter(
  h: Harness,
  x: number,
  y: number,
): { x: number; y: number } {
  const kept: { dx: number; dy: number; weight: number }[] = [];
  for (let dy = -MOTE_SEARCH; dy <= MOTE_SEARCH; dy += CENTER_STEP) {
    for (let dx = -MOTE_SEARCH; dx <= MOTE_SEARCH; dx += CENTER_STEP) {
      const [r, g, b] = h.pixel(x + dx, y + dy);
      if (r < b) continue;
      kept.push({ dx, dy, weight: luminance({ r, g, b }) });
    }
  }
  if (kept.length === 0) return { x, y };
  const brightest = Math.max(...kept.map((one) => one.weight));
  const core = kept.filter((one) => one.weight >= CORE_FRACTION * brightest);
  const total = core.reduce((sum, one) => sum + one.weight, 0);
  if (total <= 0) return { x, y };
  return {
    x: x + core.reduce((sum, one) => sum + one.dx * one.weight, 0) / total,
    y: y + core.reduce((sum, one) => sum + one.dy * one.weight, 0) / total,
  };
}

/** A mote's color profile read about a center {@link moteCenter} measured. */
export function moteProfileAt(
  h: Harness,
  center: { x: number; y: number },
): MoteSample[] {
  return MOTE_RADII.map((radius) => ({
    radius,
    color: sampleRing(h, center.x, center.y, radius),
  }));
}
