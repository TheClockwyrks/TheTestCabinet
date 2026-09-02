// lanternjaw/motes — finding an amber light precisely enough to measure a move.
//
// The suite's pixel readings live on the harness: `isWarm` is the one hue test,
// `findMote` answers where to read a profile about, `sampleMoteProfile` reads it,
// and `warmInProfile` picks the sample that carries the light. This module adds
// the one reading those cannot give, and the two Lanternjaw points that read
// pixels — `bulb-visible` and `additive-reveal` — share it.
//
// WHY NOT THE HARNESS'S OWN SEARCH. `findMote` answers a different question —
// which lattice point to read a profile about — and it walks the neighborhood in
// six-unit steps, so the answer it gives can only ever move in six-unit jumps.
// `additive-reveal` bounds how far the mote may move at FOUR units, which is finer
// than that grid: two frames of a build that never moved its bulb by a pixel can
// still land on different lattice points, because an amber core saturates toward
// white and a plateau of equal-brightest samples is resolved by whichever the scan
// reached first. Lighting the creature widens that plateau, and the tie moves.
//
// A center of mass has no such tie. Every sample of the core is weighted by how
// bright it is, so the answer sits between the lattice points rather than on one,
// a symmetric mote reads at its own middle whatever the grid, and a mote a build
// genuinely moved moves the answer by exactly as far as it moved the light. Cool
// samples are dropped, so the trench and the forager's own glow cannot pull it;
// the near-white core is kept, because that IS the light.
//
// EVERY READ CROSSES INTO THE PAGE, so the neighborhood is taken in ONE crossing
// through `h.pixels` rather than one per point: a center is a grid of well over a
// hundred samples, and taken one at a time that is a hundred round trips for one
// reading.

import {
  MOTE_SEARCH,
  luminance,
  moteProfileAbout,
  rgbOf,
  type Harness,
  type MoteSample,
} from "../harness";

/** How finely the neighborhood is walked when the mote's center is measured. */
const CENTER_STEP = 2;

/**
 * How bright a sample must be, as a fraction of the brightest in the
 * neighborhood, to count as part of the mote's core.
 */
const CORE_FRACTION = 0.9;

/**
 * WHERE the mote is drawn: the luminance-weighted center of the brightest
 * not-cool region within `MOTE_SEARCH` of `(x, y)`. See the header.
 *
 * Falls back to `(x, y)` when the neighborhood holds nothing that is not cool, so
 * a build that draws no mote at all is read exactly where it should have drawn one.
 */
export async function moteCenter(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  const offsets: { dx: number; dy: number }[] = [];
  for (let dy = -MOTE_SEARCH; dy <= MOTE_SEARCH; dy += CENTER_STEP) {
    for (let dx = -MOTE_SEARCH; dx <= MOTE_SEARCH; dx += CENTER_STEP) {
      offsets.push({ dx, dy });
    }
  }
  const read = await h.pixels(
    offsets.map((one) => ({ x: x + one.dx, y: y + one.dy })),
  );
  const kept = offsets.flatMap((one, index) => {
    const color = rgbOf(read[index]);
    if (color.r < color.b) return [];
    return [{ dx: one.dx, dy: one.dy, weight: luminance(color) }];
  });
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

/** The profile read about the mote's own measured center, found from `(x, y)`. */
export async function moteProfile(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<MoteSample[]> {
  return moteProfileAbout(h, await moteCenter(h, x, y));
}
