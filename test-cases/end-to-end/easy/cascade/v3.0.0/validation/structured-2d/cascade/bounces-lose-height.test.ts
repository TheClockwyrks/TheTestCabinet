// cascade/bounces-lose-height — each bounce peaks lower than the one before it.
//
// specs/victory.md draws the consequence of the damped bounce out in as many
// words: the vertical speed is reversed and reduced, the horizontal drift is
// untouched, "so the card keeps its horizontal drift and each bounce peaks lower
// than the one before it". That is what a player watches a cascade do, and it is
// the one thing about the bounce that no single frame shows: it is read here over
// three whole arcs.
//
// A PEAK IS READ, NOT COMPUTED. The highest point of each arc is the smallest `y`
// the card reaches between one bounce and the next, taken off the snapshot frame
// by frame, so nothing about how the build integrates the arc is assumed. y grows
// downward, so a peak that is lower on the table is a LARGER number, and the three
// peaks must therefore rise.
//
// The card is held still horizontally so it stays on the table for all three arcs,
// and it is dropped onto the floor rather than launched at it, so the first bounce
// is a fraction of a second in and the three arcs fit inside one recording.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { FLOOR_Y } from "../constants";
import { captureReplay, type Harness } from "../harness";
import {
  createFlightHarness,
  flightFrames,
  flyerOf,
  openFlight,
  poseFlight,
} from "./flight";

/** Where the card starts, and how fast. Held still horizontally, driven down. */
const START = { x: 590, y: FLOOR_Y - 100, vx: 0, vy: 1200 };

/** How many arcs are read. Three, which is what this point is stated at. */
const PEAKS = 3;

/**
 * How far the card may fly, in frames.
 *
 * The three arcs this reads take about three seconds at the stated damping, and a
 * build that damps less takes longer; five seconds covers both without letting a
 * card that never comes down run the suite out.
 */
const MAX_FRAMES = flightFrames(5);

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("peaks each bounce lower than the one before it", async () => {
  openFlight(harness);
  const id = poseFlight(harness, START);

  const peaks = await captureReplay(harness, "bounces", async () => {
    const highest: number[] = [];
    let bounces = 0;
    let peak = Number.POSITIVE_INFINITY;
    let previous = flyerOf(harness.snapshot(), id);

    for (let frame = 1; frame <= MAX_FRAMES; frame += 1) {
      await harness.advance(1);
      const now = flyerOf(harness.snapshot(), id);
      if (previous.vy > 0 && now.vy < 0) {
        // The floor turned the card around: the arc that just ended is closed and
        // the next one starts from here.
        if (bounces >= 1) highest.push(peak);
        bounces += 1;
        peak = Number.POSITIVE_INFINITY;
        if (highest.length >= PEAKS) break;
      } else if (bounces >= 1) {
        peak = Math.min(peak, now.y);
      }
      previous = now;
    }
    return highest;
  });

  assertLength(peaks, PEAKS, "bounce arcs the card completed");
  for (let arc = 1; arc < peaks.length; arc += 1) {
    assertGreaterThan(
      peaks[arc],
      peaks[arc - 1],
      `the top of bounce ${arc + 1}, which sits lower on the table than the top ` +
        `of bounce ${arc} and so reads as a larger y`,
    );
  }
});
