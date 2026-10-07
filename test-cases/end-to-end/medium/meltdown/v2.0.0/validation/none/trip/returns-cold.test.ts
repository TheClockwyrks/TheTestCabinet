// Meltdown — trip/returns-cold: it comes back online cold.
//
// `specs/heat.md` closes the trip with one sentence: "When the cooldown reaches
// `0` the emitter is online again, at heat `0`." Both halves matter and they are
// one requirement — a build that clears the flag and leaves the tower sitting on
// whatever heat its bleed happened to reach has not returned it cold, and one
// that zeroes the heat and leaves the tower offline has not returned it at all.
//
// THE TOWER IS POSED ALREADY TRIPPED, with the cooldown the specification gives
// it, so what is measured is the END of the cooldown and nothing else: reaching
// the trip is `trip/trips-at-100`'s item and the cooldown's own arithmetic is
// `trip/trip-timer-counts-down`'s.
//
// THE DRIVE RUNS TWO FRAMES PAST `TRIP_TIME`. A build is free to end the
// cooldown on the frame that takes it to exactly `0` or on the first frame that
// takes it below, and both are "when the cooldown reaches `0`" — so a drive that
// stopped on the exact boundary would fail one of two conformant builds over a
// hundredth of a second. Two frames is geometry, not a tolerance.
//
// AND THE HEAT IS ALLOWED ONE FRAME OF THE BLEED. A build that reaches `0` by
// assignment lands on it exactly; a build that reaches it by letting the `20`
// per second bleed run out and clamping can be carrying up to one frame's worth
// at the moment it returns. `20 / 120` is `0.167` of a heat point on a scale of
// `100`, so the ceiling admits both and still excludes every build that returns
// the tower at the heat it tripped at, or at half of it, or anywhere else.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import { TRIP_HEAT, TRIP_TIME } from "../constants";
import {
  TICK_HZ,
  captureStill,
  createHarness,
  framesFor,
  poseTrippedTower,
  startRun,
  type Harness,
} from "../harness";
import { TRIP_SITE, readTower } from "./bench";

/** The emitter posed tripped, at the heat and cooldown a trip leaves it with. */
const TOWER = "arc";
const POSED_HEAT = TRIP_HEAT;
const POSED_TIMER = TRIP_TIME;

/**
 * How far past the cooldown the drive runs, in frames of the default clock.
 *
 * Two frames, `0.0167` of a second: enough that a build ending the cooldown on
 * the first frame BELOW `0` has had one, and short enough that the reading is
 * still "after `5.0` seconds". Geometry, not a tolerance.
 */
const RETURN_GUARD = 2;

/** The whole cooldown, and those two frames. */
const DRIVE_FRAMES = framesFor(TRIP_TIME) + RETURN_GUARD;

/** The bleed `specs/heat.md` states: `TRIP_HEAT / TRIP_TIME`, so 20 per second. */
const BLEED_RATE = TRIP_HEAT / TRIP_TIME;

/**
 * The most heat a returned tower may still be carrying: one frame of that bleed.
 *
 * `20 / 120`, which is `0.167` of a heat point. See the head: it is the width of
 * one frame, not a margin of error on the figure `0` itself.
 */
const HEAT_CEILING = BLEED_RATE / TICK_HZ;

/**
 * How close the cooldown must come to `0`, as decimal places.
 *
 * One place is `0.05` of a second, six frames. `specs/heat.md` reports
 * `tripTimer` as "seconds left on the cooldown, else `0`"
 * (`specs/instrumentation.md`), so a returned tower carries none; the room is
 * for a build that lets the subtraction run a frame past zero before clearing
 * the field.
 */
const TIMER_DIGITS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("It comes back online cold", async () => {
  await startRun(h);
  const id = await poseTrippedTower(h, TOWER, TRIP_SITE.col, TRIP_SITE.row, {
    heat: POSED_HEAT,
    timer: POSED_TIMER,
  });

  await h.advance(DRIVE_FRAMES);
  await captureStill(h, "returned");
  const gun = await readTower(
    h,
    id,
    `the ${TOWER} ${TRIP_TIME}s after it tripped`,
  );

  assertEqual(
    gun.tripped,
    false,
    `a ${TOWER} tripped with a ${POSED_TIMER}s cooldown to be online again ` +
      `after it, with ${gun.tripTimer.toFixed(3)}s left on the clock`,
  );
  assertBetween(
    gun.heat,
    0,
    HEAT_CEILING,
    `the heat a ${TOWER} carries when it comes back online, having tripped ` +
      `from ${POSED_HEAT}`,
  );
  assertCloseTo(
    gun.tripTimer,
    0,
    TIMER_DIGITS,
    `the cooldown left on a ${TOWER} that has served its ${POSED_TIMER}s`,
  );
});
