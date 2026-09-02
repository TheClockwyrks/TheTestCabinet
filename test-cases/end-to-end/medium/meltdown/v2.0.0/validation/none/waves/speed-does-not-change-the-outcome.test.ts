// waves/speed-does-not-change-the-outcome — the speed changes the pace, not the
// result.
//
// `specs/waves.md`, Pause and speed: "The speed changes how fast a run plays and
// not what it reaches: the same game time delivered at either setting leaves the
// floor in the same state."
//
// SO THE READING IS A DISTANCE PER SECOND OF GAME TIME, AT EACH SETTING. The
// claim is that GAME TIME decides the state, so the honest way to ask it is to
// deliver a stretch of it at each setting and compare how far the floor got PER
// SECOND OF IT. Two windows are spent, one at each setting, and each window's
// travel is divided by the `simTime` that same window gained — both taken from the
// same pair of snapshots, so a leg's distance and its clock always describe the
// same stretch of the run.
//
// WHY NOT DELIVER A FIXED STRETCH OF GAME TIME INSTEAD. Because there is no way to
// ask for one that does not beg the question. `advance(seconds, frames)` is
// defined in terms of the game time it covers (`specs/instrumentation.md`), so a
// build that applies its speed multiplier inside `advance` and one that does not
// would both satisfy a check written that way while behaving differently for the
// player. Reading the ratio of travel to elapsed GAME TIME on the build's own
// clock asks the specification's question with nothing in between, and it is
// therefore measured inside `withOwnClock` with nothing in the scope calling
// `advance`.
//
// THIS ITEM AND `waves/speed-doubles-the-game-time` ARE DELIBERATELY INDEPENDENT.
// That one reads how much game time a real second buys; this one reads what a
// second of game time buys on the floor. A build whose toggle does nothing at all
// passes here and fails there, which is exactly the grade a reviewer wants: the
// speed is broken, the simulation is not. A build that speeds the SURGE up rather
// than the clock — the defect this item exists to catch — passes there and fails
// here.
//
// THE SETTING IS POSED, NOT PRESSED, so this reading is about what the setting
// does and not about which key `specs/controls.md` binds the toggle to. Posing a
// field is not stepping a clock, so it is no part of what the clock rule forbids
// inside the scope.
//
// EACH LEG IS A STRETCH OF THE BUILD'S OWN CLOCK, NOT OF THE HOST'S. The scope
// still spends real time and still steps nothing, but a leg closes when `simTime`
// has gained the seconds the leg asks for rather than when a stopwatch says so,
// and the wall clock survives only as a deadline. A page whose frame callback is
// starved by everything else on the machine advances less game time in a fixed
// stretch of real time, and a build that clamps a long frame's delta advances
// less still; a leg read off a stopwatch then divides a small travel by a small
// clock and multiplies whatever noise the machine put into both. Closing each leg
// on the same gain makes the two quotients below comparable by construction and
// leaves nothing about the runner in either of them.
//
// THE FLOOR HOLDS ONE MOTE with its motion on, no tower, and nothing that could
// slow it, so the only thing that can change its pace between the two legs is the
// setting.
//
// WHAT EVERY WRONG MODEL READS. A build that multiplies the surge's speed by the
// setting AND the clock by it as well reads twice as far per second of game time
// at `2`; one that multiplies the surge alone reads twice as far too, and is told
// apart by `waves/speed-doubles-the-game-time` passing or failing beside it; one
// that halves its integration to compensate reads half. Each is far outside the
// band below.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertTrue } from "../assert";
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
 * The game time each leg covers, on the build's own clock: a second and a half.
 *
 * Geometry rather than a tolerance. Both legs together carry the Mote about
 * fourteen tiles down a forty-nine-tile corridor (`specs/floor.md`), so it never
 * reaches its exhaust and neither reading is cut short.
 */
const LEG_SECONDS = 1.5;

/**
 * The real time a leg is given to gain {@link LEG_SECONDS} on the build's own
 * clock: a minute.
 *
 * A ceiling on the HOST and the only wall clock left in the item. A build running
 * at the wall clock's pace closes a leg in the second and a half it names, and one
 * on a machine handing its page a tenth of the frames takes fifteen and still
 * closes it. What a minute distinguishes is a build whose simulation does not
 * advance on its own at all — which is `waves/game-runs-on-its-own-clock`'s
 * verdict, and is why a leg that never closes is reported as a precondition here
 * rather than as this item's point.
 */
const LEG_DEADLINE_MS = 60_000;

/** The two settings the toggle offers (`specs/waves.md`). */
const SLOW = 1;
const FAST = 2;

/**
 * How far the two legs' travel per second of game time may differ: a tenth.
 *
 * The specification's claim is exact — the same game time leaves the floor in the
 * same state — so this is measurement slack. Each leg's distance and its clock
 * come from the same pair of snapshots, which removes the round trip from the
 * quotient entirely; what is left is the difference in how the two legs' frames
 * happened to be diced, which a per-second rate is insensitive to. A tenth is far
 * below the doubling or halving that every wrong model here produces.
 */
const RATIO_TOLERANCE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("carries a walker the same distance per second of game time at either speed", async () => {
  await startRun(h);
  const mote = await poseRunningFloor(h);
  await h.debug.setSpeed(SLOW);

  const legs = await h.withOwnClock(async (clock) => {
    const slowOpened = await clock.read();
    const slowGained = await clock.gain(LEG_SECONDS, LEG_DEADLINE_MS);
    const slowSettled = await clock.read();
    // A pose of one field, not a step of the clock.
    await h.debug.setSpeed(FAST);
    const fastOpened = await clock.read();
    const fastGained = await clock.gain(LEG_SECONDS, LEG_DEADLINE_MS);
    return {
      slowOpened,
      slowGained,
      slowSettled,
      fastOpened,
      fastGained,
      fastSettled: await clock.read(),
    };
  });

  await captureStill(h, "outcome");

  const at = (snapshot: typeof legs.slowOpened) =>
    requireUnit(snapshot, mote, "the two windows on the build's own clock");

  const slowClock = legs.slowSettled.simTime - legs.slowOpened.simTime;
  const fastClock = legs.fastSettled.simTime - legs.fastOpened.simTime;
  const slowRate =
    distance(at(legs.slowOpened), at(legs.slowSettled)) / slowClock;
  const fastRate =
    distance(at(legs.fastOpened), at(legs.fastSettled)) / fastClock;

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
  assertTrue(
    legs.slowGained.reached,
    `precondition: the build's own clock gained ${LEG_SECONDS} seconds at speed ` +
      `${SLOW} within ${LEG_DEADLINE_MS / 1000}s of real time — it gained ` +
      `${slowClock.toFixed(3)}`,
  );
  assertTrue(
    legs.fastGained.reached,
    `precondition: the build's own clock gained ${LEG_SECONDS} seconds at speed ` +
      `${FAST} within ${LEG_DEADLINE_MS / 1000}s of real time — it gained ` +
      `${fastClock.toFixed(3)}`,
  );
  assertBetween(
    fastRate / slowRate,
    1 - RATIO_TOLERANCE,
    1 + RATIO_TOLERANCE,
    `the units a Mote covered per second of game time at speed ${FAST} against speed ${SLOW}`,
  );
});
