// cursor/fire-interval — a held fire action produces a bolt every
// FIRE_INTERVAL.
//
// specs/cursor.md: "While the fire action is held, a bolt is fired whenever the
// cooldown is at `0` and fewer than `MAX_BOLTS` bolts are in flight, and firing
// sets the cooldown to `FIRE_INTERVAL` [0.15 s]. A held fire action therefore
// produces a bolt every `FIRE_INTERVAL` until the cap binds."
//
// WHY THE HOLD IS 0.35 S. Long enough for three bolts and the two intervals
// between them — the third is fired at 0.30 s — and short enough that
// `MAX_BOLTS` (3) never binds inside it: the cap would first refuse a shot at
// 0.45 s, and a hold that ran that far would be measuring `cursor.bolt-cap`'s
// requirement instead of this one. The column is empty and no bolt can leave the
// board inside the window either — the muzzle sits about 596 units below
// `BOARD_Y` and a bolt at `BOLT_SPEED` (900) needs 0.66 s to cover that — so
// every change in the roster inside the window is a firing.
//
// The cooldown is set to zero first, so the window opens on a frame the cursor
// may fire on and the first interval is measured from a real shot rather than
// from whatever the cooldown happened to hold.

import { afterEach, beforeEach, it } from "vitest";
import { FIRE_INTERVAL } from "../constants";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  holdAction,
  releaseAction,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The window the fire action is held for, in frames: 0.35 s. */
const HOLD_TICKS = ticksFor(0.35);

/** How many bolts that window is required to produce. */
const EXPECTED_SHOTS = 3;

/**
 * How far each measured interval may sit from `FIRE_INTERVAL`, in seconds: the
 * 10% the review item states, which is 0.015 s. The suite's frame is 1/120 s, so
 * the tolerance is nearly two frames wide either way — room for a build that
 * fires on the frame after the cooldown reaches zero rather than on it.
 */
const INTERVAL_TOLERANCE = FIRE_INTERVAL * 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires three bolts 0.15 s apart over a 0.35 s hold", async () => {
  startPlaying(h);
  h.debug.setCursor(BAND_CX, BAND_CY);
  h.debug.setFireCooldown(0);

  /** The frame of the hold each new bolt turned up on, 1-based. */
  const shots: number[] = [];
  holdAction(h, "a");
  try {
    let inFlight = h.snapshot().bolts.length;
    for (let frame = 1; frame <= HOLD_TICKS; frame += 1) {
      await h.advance(1);
      const now = h.snapshot().bolts.length;
      if (now > inFlight) shots.push(frame);
      inFlight = now;
    }
  } finally {
    releaseAction(h, "a");
  }
  captureStill(h, "burst");

  assertLength(shots, EXPECTED_SHOTS, "bolts fired over the 0.35 s hold");
  for (let index = 1; index < shots.length; index += 1) {
    const gap = seconds(shots[index] - shots[index - 1]);
    assertLessThanOrEqual(
      Math.abs(gap - FIRE_INTERVAL),
      INTERVAL_TOLERANCE,
      `the gap between shot ${index} and shot ${index + 1} was ${gap} s`,
    );
  }
});
