// bays/fill-starts-fresh-crossing — once the bay-fill hold has run out, the next
// crossing is under way from the near shore, on a full timer.
//
// specs/bays.md: "When open bays remain, a fresh crossing then begins from the
// near shore after the hold `specs/progression.md` fixes."
// specs/progression.md fixes that hold at `BAYFILL_PAUSE` (`0.5` s) and fixes
// what a fresh crossing is: "the critter on the near shore at column `START_COL`
// (`20`) ... The crossing timer goes back to `timerMax`."
//
// THE TIMER IS POSED AWAY FROM ITS FULL VALUE FIRST. Left at `timerMax` it would
// read `timerMax` afterwards whether the build reset it or never touched it, and
// the point would pass on a build with no reset at all. Posed at `POSED_TIMER`
// the two models read different numbers, and the check names both: the timer is
// back at whatever the snapshot reports as `timerMax`, and it is no longer the
// value the check left it at.
//
// `timerMax` itself is read from the build rather than computed here. What the
// level-1 crossing timer is worth is `progression/timer-length-level-1`'s
// requirement, not this one, and a build that got that figure wrong should fail
// there and nowhere else.
//
// The timer's DRAIN stays gated off, as `startCrossing` leaves it: with it
// running the reading below would be `timerMax` minus however much of the hold
// had elapsed. `specs/instrumentation.md` is explicit that the gate does not
// touch this — "It still resets on a filled bay" — so the reset the point is
// about runs exactly as it does in play.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { BAYFILL_PAUSE, ROW_NEAR, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  keyFor,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { poseAtBayMouth } from "./bay-mouth";

/** The bay this point fills. Four stay open, so a crossing follows rather than a clear. */
const BAY = 1;

/**
 * The timer the crossing is posed with before the bay is filled.
 *
 * Any value the level's own `timerMax` is not. Seven seconds is well inside a
 * level-1 crossing's thirty (`specs/progression.md`), so the pose is a crossing
 * part-way through rather than an impossible one.
 */
const POSED_TIMER = 7;

/**
 * The hold, driven out: `BAYFILL_PAUSE` (`0.5` s) is exactly `60` whole frames at
 * the `TICK_HZ` (`120`) `specs/overview.md` fixes, and one frame of this suite is
 * one tick.
 */
const HOLD_FRAMES = ticksFor(BAYFILL_PAUSE);

/**
 * One frame of room past the hold.
 *
 * The hold's own length is `progression`'s requirement, not this one; all this
 * point needs is to be standing on the far side of it. The extra frame covers a
 * build that tests its hold before subtracting the tick rather than after, and
 * the rounding of sixty subtractions of a hundred-and-twentieth.
 */
const TOLERANCE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("puts a fresh critter on the near shore with a full timer", async () => {
  startCrossing(h);
  poseAtBayMouth(h, BAY);
  h.debug.setTimer(POSED_TIMER);

  const fresh = await captureReplay(h, "fill", async () => {
    await h.tap(keyFor("up"));
    await h.advance(HOLD_FRAMES + TOLERANCE_FRAMES);
    return h.snapshot();
  });

  assertEqual(fresh.critter.present, true, "a critter back on the strait");
  assertEqual(fresh.critter.col, START_COL, "the column a crossing begins on");
  assertEqual(fresh.critter.row, ROW_NEAR, "the near shore");
  assertEqual(
    fresh.timer,
    fresh.timerMax,
    "the crossing timer, back at timerMax",
  );
  assertNotEqual(
    fresh.timer,
    POSED_TIMER,
    "the timer the filled crossing was left on",
  );
});
