// Arc Foundry — reading a patch of the canvas, for the animation checks that ask
// whether a produced cycle is actually PLAYED. CASE-PROVIDED.
//
// Two of this category's points are not about the files at all: they ask whether
// what the build drew changes over time the way `specs/assets.md` says a cycle
// does — "a firing structure visibly charges and discharges", "an idle cycle
// loops while its subject is on the yard". The only thing that can answer that
// from outside the build is the canvas, so a patch of it is sampled on a lattice
// and the readings compared frame to frame.
//
// SAMPLED ON A LATTICE RATHER THAN AT A POINT. A cycle may change any part of its
// subject, so one pixel is a coin toss; a lattice over the whole subject reads a
// change wherever the build put it. The readings are compared exactly: the harness
// steps the game itself, so two frames that drew the same thing are byte-identical
// and there is nothing to tolerance away.

import type { Harness } from "../harness";
import type { Point } from "../constants";

/** A square lattice of points about `center`, `half` either side, `step` apart. */
export function lattice(center: Point, half: number, step: number): Point[] {
  const points: Point[] = [];
  for (let dy = -half; dy <= half; dy += step) {
    for (let dx = -half; dx <= half; dx += step) {
      points.push({ x: center.x + dx, y: center.y + dy });
    }
  }
  return points;
}

/** What the canvas holds at those points right now, as one comparable reading. */
export async function read(
  h: Harness,
  points: readonly Point[],
): Promise<string> {
  const sampled = await h.pixels(points);
  return sampled.map((pixel) => pixel.join(",")).join(" ");
}

/**
 * One reading per frame, over `frames` frames, starting with the frame just run.
 *
 * The current frame is read first and then each of `frames` further frames, so a
 * caller that has just driven the frame an event happened on reads that frame and
 * the ones after it.
 */
export async function readOverFrames(
  h: Harness,
  points: readonly Point[],
  frames: number,
): Promise<string[]> {
  const readings = [await read(h, points)];
  for (let i = 0; i < frames; i += 1) {
    await h.advance(1);
    readings.push(await read(h, points));
  }
  return readings;
}

/** How many different pictures a run of readings holds. */
export function distinct(readings: readonly string[]): number {
  return new Set(readings).size;
}
