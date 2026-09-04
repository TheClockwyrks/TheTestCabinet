// cascade/bounces-lose-height — each bounce peaks lower than the one before it.
//
// specs/victory.md draws the consequence of the damping itself: with `vx`
// unchanged and the vertical speed cut to `BOUNCE_DAMP` (`0.80`) of what it
// arrived with, "each bounce peaks lower than the one before it". That is the
// statement this point reads, and it reads it as the specification states it —
// as an ORDERING of three successive peaks rather than as a ratio, because the
// ratio is `floor-bounce-damps` and grading it twice would dock one wrong figure
// in two places.
//
// A PEAK IS THE HIGHEST POINT BETWEEN TWO BOUNCES, found from the frames
// themselves: the card is sampled every frame, a bounce is the frame `vy` turns
// from descending to ascending, and the peak of the arc that follows is the
// smallest `y` before the next bounce. Three arcs need four bounces, which the
// posed drop reaches in `1.27` s.
//
// The card has no horizontal drift, so it stays on the table for every bounce and
// nothing retires mid-reading; nothing is launching, so the flight is one card.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertTrue } from "../assert";
import { FLOOR_Y } from "../constants";
import {
  type Harness,
  captureReplay,
  createHarness,
  framesFor,
  poseFlyer,
} from "../harness";
import { frameSamples, openFlight } from "./flight";

/** A card dropped onto the floor from close above it, already moving down. */
const DROP = { x: 400, y: FLOOR_Y - 60, vx: 0, vy: 200 };

/**
 * How far the drive runs, in frames.
 *
 * The fourth bounce of that drop lands at `1.27` s under the figures
 * `specs/victory.md` fixes. This is room over it, and a bound on the drive
 * rather than a reading of it.
 */
const DRIVE_FRAMES = framesFor(1.4);

/** How many peaks the review item asks for. */
const PEAKS = 3;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("peaks lower on each successive bounce", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, DROP);

  const samples = await captureReplay(harness, "bounces", () =>
    frameSamples(harness, DRIVE_FRAMES),
  );
  const flights = samples.map((s) => s.flyers.find((f) => f.id === id));

  const bounces: number[] = [];
  for (let i = 1; i < flights.length; i += 1) {
    const before = flights[i - 1];
    const after = flights[i];
    if (before !== undefined && after !== undefined) {
      if (before.vy > 0 && after.vy < 0) bounces.push(i);
    }
  }
  assertTrue(
    bounces.length > PEAKS,
    `the card to bounce ${PEAKS + 1} times within ${DRIVE_FRAMES} frames, so there are ${PEAKS} arcs between bounces to compare, and it bounced ${bounces.length} time(s)`,
  );

  // The highest point of each arc: the smallest y between one bounce and the
  // next, on a stage whose y grows downward (`specs/overview.md`).
  const peaks: number[] = [];
  for (let arc = 0; arc < PEAKS; arc += 1) {
    let highest = FLOOR_Y;
    for (let i = bounces[arc]; i < bounces[arc + 1]; i += 1) {
      const flyer = flights[i];
      if (flyer !== undefined) highest = Math.min(highest, flyer.y);
    }
    peaks.push(highest);
  }

  for (let arc = 1; arc < PEAKS; arc += 1) {
    assertLessThan(
      peaks[arc - 1],
      peaks[arc],
      `bounce ${arc + 1} to peak lower than bounce ${arc}, so its highest y (${peaks[arc]}) is further down the stage than bounce ${arc}'s`,
    );
  }
});
