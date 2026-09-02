// cascade/bounces-lose-height — each bounce peaks lower than the one before it.
//
// specs/victory.md draws the consequence of the damped bounce out in as many words:
// the vertical speed is reversed and reduced, the horizontal drift is untouched, "so
// the card keeps its horizontal drift and each bounce peaks lower than the one before
// it". That is what a player watches a cascade do, and it is the one thing about the
// bounce no single frame shows: it is read here over three whole arcs.
//
// AN ARC IS READ, NOT COMPUTED. Each arc's height is the distance between the y the
// card was left at when the floor turned it around and the smallest y it reached
// before the next bounce, both taken off the snapshot frame by frame. Measuring from
// the bounce rather than from `FLOOR_Y` keeps this point clear of
// `floor-bounce-seats`: a build that seats a bounced card somewhere else is docked
// there, and its arcs are still read here for what they are.
//
// THE DROP ASKED FOR IS A FLOOR, NOT THE FIGURE. specs/victory.md's damping puts
// successive arcs in the ratio `BOUNCE_DAMP` squared, `0.64`, which is a drop of more
// than a third; what this asks for is a twentieth of that. The margin is there
// because a frame-sampled arc carries a fraction of a percent of drift of its own,
// from the sub-frame overshoot the seating takes back, and a build whose arcs are
// genuinely level must not be passed by it. How much of the speed a bounce keeps is
// `floor-bounce-damps`, and this point deliberately asks for far less than that
// figure so that a build with the damping slightly off is docked once.
//
// The card is held still horizontally so it stays on the table for all three arcs,
// and it is dropped onto the floor rather than launched at it, so the first bounce is
// a fraction of a second in and the three arcs fit inside one recording.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import { BOUNCE_DAMP, FLOOR_Y } from "../constants";
import {
  captureReplay,
  createHarness,
  flyerOf,
  framesFor,
  type Harness,
} from "../harness";
import { openFlight, poseFlyer } from "./flight";

/** Where the card starts, and how fast. Held still horizontally, driven down. */
const START = { x: 590, y: FLOOR_Y - 100, vx: 0, vy: 1200 };

/** How many arcs are read. Three, which is what this point is stated at. */
const PEAKS = 3;

/**
 * How far the card may fly, in frames.
 *
 * The three arcs this reads take about three seconds at the stated damping, and a
 * build that damps less takes longer; eight seconds covers a build that barely damps
 * at all and is short enough that a card which never comes down is reported rather
 * than left running.
 */
const MAX_FRAMES = framesFor(8);

/**
 * The share of an arc's height the next arc must have lost.
 *
 * A twentieth of the `1 - BOUNCE_DAMP * BOUNCE_DAMP` the stated damping produces, so
 * a build that damps as specified clears it seven times over and a build whose arcs
 * are level cannot clear it at all.
 */
const MIN_DROP = (1 - BOUNCE_DAMP * BOUNCE_DAMP) / 20;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("peaks each bounce lower than the one before it", async () => {
  openFlight(harness);
  const id = poseFlyer(harness, START);

  const heights = await captureReplay(harness, "bounces", async () => {
    const arcs: number[] = [];
    let from = Number.NaN;
    let peak = Number.POSITIVE_INFINITY;
    let previous = flyerOf(harness.snapshot(), id);

    for (let frame = 1; frame <= MAX_FRAMES; frame += 1) {
      await harness.advance(1);
      const now = flyerOf(harness.snapshot(), id);
      if (previous.vy > 0 && now.vy < 0) {
        // The floor turned the card around: the arc that just ended is closed, and
        // the next one is measured from where this bounce left the card.
        if (!Number.isNaN(from)) arcs.push(from - peak);
        from = now.y;
        peak = Number.POSITIVE_INFINITY;
        if (arcs.length >= PEAKS) break;
      } else if (!Number.isNaN(from)) {
        peak = Math.min(peak, now.y);
      }
      previous = now;
    }
    return arcs;
  });

  assertLength(heights, PEAKS, "bounce arcs the card completed");
  for (let arc = 1; arc < heights.length; arc += 1) {
    assertLessThanOrEqual(
      heights[arc],
      heights[arc - 1] * (1 - MIN_DROP),
      `the height of bounce ${arc + 1}, against the ${heights[arc - 1]} logical ` +
        `units bounce ${arc} reached`,
    );
  }
});
