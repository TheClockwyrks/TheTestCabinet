// Deepcore — reading that an effect PLAYED, and where. CASE-PROVIDED.
//
// `specs/assets.md` requires each of the twelve effects authored with
// `particle-2d` and "played live, so it varies shot to shot", and spawned "at the
// event's position: the debris at the bit, the exhaust under the jetpack, the
// sparkle at the pickup, the blast at the pocket, the launch exhaust under the
// rocket". What it deliberately does not fix is HOW a build gets a produced system
// onto the canvas — the runtime's own `/canvas` binding draws each particle as a
// disc, and a build is equally free to play a burst onto a small offscreen field
// and composite that over the mine in one operation, which is what the binding's
// own field/footprint design invites.
//
// So what these points read is neither the discs nor the composite: it is that the
// frame issues MORE DRAWING near the event's position while the effect plays than
// the same scene issues without it. Both ways of getting a system on screen add
// operations there, and a build that draws nothing — the "flat opacity flash or a
// hand-coded loop" the contract refuses, or nothing at all — adds none.
//
// THE COMPARISON IS ALWAYS AGAINST THE SAME SCENE. A count of operations near a
// point is mostly the tiles under it, so a bare number says nothing; what says
// something is the same count taken over the same posed world with the event not
// happening. Every point here takes that control itself.

import { drawsNear, frameDraws } from "./drawn";
import type { Harness } from "../harness";

/**
 * Drive `frames` frames and report the most drawing any one of them put within
 * `radius` of `at`.
 *
 * `at` is re-read before each frame where the event moves, through the `where`
 * callback, so a plume under a rising miner is measured under the miner rather
 * than where it started.
 */
export async function peakNear(
  h: Harness,
  frames: number,
  radius: number,
  where: () => { x: number; y: number },
): Promise<number> {
  let peak = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const at = where();
    peak = Math.max(peak, drawsNear(await frameDraws(h), at, radius));
  }
  return peak;
}

/** Drive `frames` frames and report what each put within `radius` of a fixed point. */
export async function seriesNear(
  h: Harness,
  frames: number,
  radius: number,
  at: { x: number; y: number },
): Promise<number[]> {
  const series: number[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    series.push(drawsNear(await frameDraws(h), at, radius));
  }
  return series;
}

/**
 * Drive `frames` frames and report, for each of several fixed points, the most
 * drawing any one frame put within `radius` of it.
 *
 * One pass for every point, because a round robin is about what happens over the
 * SAME stretch of time at several places at once: reading them one at a time would
 * be reading a different stretch for each.
 */
export async function peaksNear(
  h: Harness,
  frames: number,
  radius: number,
  points: readonly { x: number; y: number }[],
): Promise<number[]> {
  const peaks = points.map(() => 0);
  for (let frame = 0; frame < frames; frame += 1) {
    const draws = await frameDraws(h);
    for (const [at, point] of points.entries()) {
      peaks[at] = Math.max(peaks[at], drawsNear(draws, point, radius));
    }
  }
  return peaks;
}
