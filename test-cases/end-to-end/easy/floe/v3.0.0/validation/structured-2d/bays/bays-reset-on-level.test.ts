// bays/bays-reset-on-level — the level that follows a clear opens with all five
// bays open again.
//
// specs/progression.md: "When the hold expires, `level` and `reachedLevel` rise
// by one, the strait is laid out for the new level with all five bays open and no
// bonus catch out, and a fresh crossing begins." specs/bays.md fixes the other
// half of the same rule from the bays' side: a bay is filled "until the level is
// over".
//
// The scenario is reached DIRECTLY, by posing the clearing hold rather than by
// hopping into a fifth bay. A level advance IS the expiry of that hold: what
// starts it is `bays/all-five-clears`'s requirement and what it costs in time is
// `progression/level-advances`'s, and neither is this point's. So the five bays
// are posed filled — which on its own clears nothing
// (`bays/posed-full-does-not-clear`) — the phase is posed to `clearing` with its
// hold, and the hold is run out.
//
// The level rise is read alongside the bays, as the situation rather than the
// requirement: a build that opened five bays without advancing the level has not
// done what this point is about, and would otherwise pass.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BAY_COUNT, CLEAR_PAUSE } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The level the clear is taken from. Below `TOTAL_LEVELS`, so a level follows it. */
const LEVEL = 2;

/** Five bays posed filled, and the five open ones the new level must open with. */
const ALL_FILLED: boolean[] = Array.from({ length: BAY_COUNT }, () => true);
const ALL_OPEN: boolean[] = Array.from({ length: BAY_COUNT }, () => false);

/**
 * Whole frames covering `CLEAR_PAUSE` (`1.6` s) at the `TICK_HZ` (`120`)
 * `specs/overview.md` fixes — one frame of this suite is one tick.
 */
const HOLD_FRAMES = ticksFor(CLEAR_PAUSE);

/**
 * One frame of room past the hold.
 *
 * The hold's length belongs to `progression/level-advances`; this point only has
 * to be standing on the far side of it. The extra frame covers a build that tests
 * its hold before subtracting the tick rather than after, and the rounding of a
 * hundred and ninety-two subtractions of a hundred-and-twentieth.
 */
const TOLERANCE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens the next level with every bay open again", async () => {
  startCrossing(h, LEVEL);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) h.debug.setBay(bay, true);
  h.debug.setPhase("clearing");
  h.debug.setPhaseTimer(CLEAR_PAUSE);

  const posed = h.snapshot();
  assertDeepEqual(
    posed.bays,
    ALL_FILLED,
    "the five filled bays the clear ends",
  );

  const opened = await captureReplay(h, "reset", async () => {
    await h.advance(HOLD_FRAMES + TOLERANCE_FRAMES);
    return h.snapshot();
  });

  assertEqual(opened.level, LEVEL + 1, "the level the advance opened");
  assertDeepEqual(opened.bays, ALL_OPEN, "every bay open on the new level");
});
