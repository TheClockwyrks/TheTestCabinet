// progression/level-advances — the clearing hold a level's last bay begins runs for
// `CLEAR_PAUSE`, and the level that follows opens when it expires.
//
// specs/progression.md, below `TOTAL_LEVELS`: "`phase` becomes `clearing` for
// `CLEAR_PAUSE`. When the hold expires, `level` and `reachedLevel` rise by one, the
// strait is laid out for the new level ... and a fresh crossing begins."
// specs/bays.md fixes what starts it: "A level is cleared by the hop that fills its
// last open bay."
//
// THIS POINT OWNS THE HOLD'S LENGTH. That the hop moves the phase to `clearing` at
// all is `bays/all-five-clears`, and that the new level opens with five open bays is
// `bays/bays-reset-on-level`; what neither reads is HOW LONG the hold runs. So the
// clear is started by a real hop — which is the only event that starts one — and
// timed from the tick that hop landed on.
//
// TWO READINGS, ONE EITHER SIDE, WHICH IS WHAT MAKES IT A DURATION. A single reading
// past the end would pass a build that advanced the level instantly, and a single
// reading before it would pass one that never advanced at all. `EARLY` is a tenth of
// a second short of the hold, where a build that has held it is still `clearing` on
// the level it cleared; `LATE` is a tenth past it, where the next level is open and a
// crossing is under way. The tenth of a second is twelve whole ticks at the `TICK_HZ`
// (`120`) specs/overview.md fixes, so neither reading turns on rounding, and a build
// whose hold is half as long or twice as long fails on the reading that names which
// way it was wrong.
//
// LEVEL 3 IS THE DISTINGUISHING VALUE. The level that follows must read `4`, so a
// build that restarted the run reads `1`, one that reset to the first level and
// counted from there reads `2`, and one that never advanced reads `3`. It is also
// below `TOTAL_LEVELS`, so the clear is a hold rather than the victory
// `progression/victory-on-level-8` is about.
//
// FOUR BAYS ARE POSED FILLED AND THE FIFTH IS HOPPED INTO, because posing the fifth
// as well would clear nothing (`bays/posed-full-does-not-clear`). The open one is bay
// `2`, the middle of the five, so a build that only notices its first or its last bay
// leaves the level running and fails here rather than passing by accident.

import { afterEach, beforeEach, it } from "vitest";
import { BAY_COUNT, CLEAR_PAUSE } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { poseAtBayMouth, requestHop } from "./crossing";

/** The level the clear is taken on: below `TOTAL_LEVELS`, so a level follows it. */
const LEVEL = 3;

/** The one bay left open for the hop — the middle of the five. */
const OPEN_BAY = 2;

/** Every bay filled, which is what the clearing hop leaves behind. */
const ALL_FILLED: boolean[] = Array.from({ length: BAY_COUNT }, () => true);

/** How far either side of `CLEAR_PAUSE` the two readings are taken, in seconds. */
const TOLERANCE = 0.1;

/** The two readings, in ticks after the tick the clearing hop landed on. */
const EARLY = ticksFor(CLEAR_PAUSE - TOLERANCE);
const LATE = ticksFor(CLEAR_PAUSE + TOLERANCE) - EARLY;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the next level a second and six tenths after the level's last bay is filled", async () => {
  startCrossing(h, LEVEL);
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    if (bay !== OPEN_BAY) h.debug.setBay(bay, true);
  }
  poseAtBayMouth(h, OPEN_BAY);

  const posed = h.snapshot();
  assertEqual(posed.level, LEVEL, "the level the clear is taken on");
  assertEqual(posed.phase, "crossing", "four posed bays clear nothing");

  const { cleared, held, opened } = await captureReplay(
    h,
    "advance",
    async () => {
      await requestHop(h, "up");
      const landed = h.snapshot();
      await h.advance(EARLY);
      const inside = h.snapshot();
      await h.advance(LATE);
      return { cleared: landed, held: inside, opened: h.snapshot() };
    },
  );

  // The situation the two readings were taken in: that hop really did fill the
  // level's last open bay and really did start a clearing hold.
  assertDeepEqual(
    cleared.bays,
    ALL_FILLED,
    "the last open bay filled by that hop",
  );
  assertEqual(cleared.phase, "clearing", "the clearing hold that hop began");

  assertEqual(
    held.phase,
    "clearing",
    `still clearing a tenth of a second short of CLEAR_PAUSE (${CLEAR_PAUSE} s)`,
  );
  assertEqual(
    held.level,
    LEVEL,
    "the level unchanged while the clearing hold is still running",
  );

  assertEqual(
    opened.level,
    LEVEL + 1,
    `the level CLEAR_PAUSE (${CLEAR_PAUSE} s) opened (specs/progression.md)`,
  );
  assertEqual(
    opened.phase,
    "crossing",
    "the crossing the expired hold begins on the new level",
  );
});
