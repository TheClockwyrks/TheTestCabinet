// waves/speed-doubles-the-game-time — at speed 2 the game runs twice the game time
// per unit of elapsed time.
//
// `specs/waves.md`, Pause and speed: "The game-speed toggle sets `speed` to `1` or
// `2`, and the game time a frame advances by is that frame's elapsed time
// multiplied by `speed`, so at `2` the game advances twice the game time per unit
// of elapsed time and `simTime` gains twice as fast."
//
// THE MULTIPLIER IS BETWEEN ELAPSED TIME AND GAME TIME, so it can only be read
// against ELAPSED time — which is to say on the build's own clock. A check that
// asked the debug surface to `advance` a second of game time at each setting would
// be asking the instrumentation what a second means and would learn nothing about
// the toggle: `specs/instrumentation.md` defines `advance(seconds, frames)` in
// terms of the game time it covers, not the wall clock it costs. So the clock is
// handed back to the build with `withOwnClock`, two real windows of the same
// length are spent, and nothing inside the scope calls `advance` or anything built
// on it.
//
// TWO READINGS OF THE ONE CLAIM. `simTime`, which the specification names
// directly, and a walker's travel, because a build could double the clock without
// doubling what is integrated against it — a run that reports twice the time and
// plays at the same pace. Both are read from the pair of snapshots that bound each
// window, so each ratio spans its own window and nothing else.
//
// THE SETTING IS POSED, NOT PRESSED. `setSpeed` "Sets the game-speed toggle, `1`
// or `2`" and is a pose of that one field (`specs/instrumentation.md`), which
// leaves this reading about what the SETTING does. Whether the `speed` action
// toggles between the two figures is `controls.*`'s requirement, and a build that
// binds the wrong key should not fail this item as well. Posing a field is not
// stepping a clock, so it is no part of what the clock rule forbids inside the
// scope.
//
// THE LEGS RUN IN THE ORDER 1 THEN 2, and each is read from its own pair of
// snapshots taken inside the scope, so the press-free handover between them costs
// neither leg any time.
//
// WHAT EVERY WRONG MODEL READS. A build whose toggle does nothing reads a ratio of
// `1`; one that doubles the frame RATE rather than the game time per frame reads
// `1` as well, since twice as many frames of half the elapsed time cover the same
// ground; one that squares the setting or applies it twice reads `4`; one that
// halves instead reads `0.5`. Each is far outside the band below.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";
import { poseRunningFloor } from "./run";

/**
 * The real time each leg is measured over: a second and a half.
 *
 * Geometry rather than a tolerance. It is long enough that the handful of
 * milliseconds a snapshot's round trip costs is a rounding error against it, and
 * short enough that both legs and their readings cost a few seconds of wall clock.
 */
const SPEED_WINDOW_MS = 1500;

/** The two settings the toggle offers (`specs/waves.md`). */
const SLOW = 1;
const FAST = 2;

/** What the second leg must carry per unit of elapsed time, against the first. */
const EXPECTED_RATIO = FAST / SLOW;

/**
 * How far each ratio may miss `2` by: `0.4`.
 *
 * The windows are real time, so what a leg actually covers is the window plus
 * whatever the machine's scheduler took: a frame late at either end of a
 * second-and-a-half window is one per cent, and a suite running four pages at once
 * can lose several. Twenty per cent is generous against that and still names one
 * answer — the band runs from `1.6` to `2.4`, which excludes the `1` a dead toggle
 * reads, the `4` a doubly-applied one reads, and the `0.5` an inverted one reads,
 * by margins many times its own width.
 *
 * It is the one bound in this group WIDER than the other two engines' copies of this
 * point, and the reason is the measurement rather than the requirement: under an
 * engine the two legs are the same number of frames of the same fixed clock, so the
 * ratio is exact and `0.05` is all the room a build needs, while here the legs are
 * real windows a loaded machine can stretch. The rule being decided is the same one,
 * and every wrong reading of it is excluded under all three.
 */
const RATIO_TOLERANCE = 0.4;

/**
 * How much `simTime` the first leg must gain for the ratio to mean anything: half
 * a second.
 *
 * Not a tolerance but a guard against dividing by nothing: a build that does not
 * advance at all would otherwise read a ratio of zero over zero. The figure is the
 * one `waves/game-runs-on-its-own-clock` holds a window to, and that item is where
 * a floor that does not advance is graded.
 */
const MIN_CLOCK_GAIN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("gains twice the game time and twice the travel over the same real window", async () => {
  await startRun(h);
  const mote = await poseRunningFloor(h);
  await h.debug.setSpeed(SLOW);

  const legs = await h.withOwnClock(async (clock) => {
    const slowOpened = await clock.read();
    await clock.settle(SPEED_WINDOW_MS);
    const slowSettled = await clock.read();
    // A pose of one field, not a step of the clock: the scope stays on the
    // build's own frame loop throughout.
    await h.debug.setSpeed(FAST);
    const fastOpened = await clock.read();
    await clock.settle(SPEED_WINDOW_MS);
    return {
      slowOpened,
      slowSettled,
      fastOpened,
      fastSettled: await clock.read(),
    };
  });

  await captureStill(h, "doubled");

  const at = (snapshot: typeof legs.slowOpened) =>
    requireUnit(snapshot, mote, "the two windows on the build's own clock");

  const slowClock = legs.slowSettled.simTime - legs.slowOpened.simTime;
  const fastClock = legs.fastSettled.simTime - legs.fastOpened.simTime;
  const slowTravel = distance(at(legs.slowOpened), at(legs.slowSettled));
  const fastTravel = distance(at(legs.fastOpened), at(legs.fastSettled));

  assertEqual(
    legs.slowSettled.speed,
    SLOW,
    `precondition: the first window ran at speed ${SLOW}`,
  );
  assertEqual(
    legs.fastOpened.speed,
    FAST,
    `precondition: the second window ran at speed ${FAST}`,
  );
  assertGreaterThan(
    slowClock,
    MIN_CLOCK_GAIN,
    `precondition: the game advanced at all across the speed ${SLOW} window`,
  );
  assertBetween(
    fastClock / slowClock,
    EXPECTED_RATIO - RATIO_TOLERANCE,
    EXPECTED_RATIO + RATIO_TOLERANCE,
    `the simTime speed ${FAST} gained over one real window against speed ${SLOW}'s`,
  );
  assertBetween(
    fastTravel / slowTravel,
    EXPECTED_RATIO - RATIO_TOLERANCE,
    EXPECTED_RATIO + RATIO_TOLERANCE,
    `the units a Mote covered at speed ${FAST} over one real window against speed ${SLOW}'s`,
  );
});
