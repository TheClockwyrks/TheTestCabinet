// waves/game-runs-on-its-own-clock — with nothing stepping it, the game advances
// itself.
//
// `specs/waves.md`, The simulation advances itself: "The game advances by the
// elapsed time of every frame, multiplied by the game speed. Every rate in this
// specification is per second and is integrated against that game time, and
// `simTime` accumulates it".
//
// THIS IS THE POSITIVE DIRECTION OF THE CLOCK RULE, and it is the item every
// other clock reading rests on. `specs/instrumentation.md`'s `setAutoStep(false)`
// exists so a check can take the game OFF real time and step it; every other
// point in this project uses it, and a build that runs only when stepped would
// pass every one of them while being unplayable. So this window spends REAL time
// with the clock handed back — `setAutoStep(true)`, which
// `specs/instrumentation.md` calls "how a build starts and how it is played" —
// and nothing inside it calls `advance` or anything built on it.
//
// TWO READINGS OF THE ONE CLAIM. A Mote must have travelled, and `simTime` must
// have gained, because a build could animate a walker off wall-clock time while
// its simulation clock stood still, or run a clock nothing is integrated against.
// Both come from snapshots at the two ends of one window.
//
// THE FLOOR HOLDS ONE MOTE AND NOTHING ELSE. `poseRunningFloor` empties both
// rosters through `startRun` and leaves the world gate shut, so nothing arrives
// beside it and what the window measures is the game's own locomotion rather than
// a position this check wrote.
//
// THE STILLS ARE THE EVIDENCE THE ITEM ASKS FOR: the instant the window opened
// and the same floor moments later, both taken off the canvas the build's own
// frame loop drew.
//
// WHAT EVERY WRONG MODEL READS. A build that advances only when stepped reads a
// travel of `0` and a `simTime` gain of `0`; one that draws an animation without
// advancing its simulation reads travel with no gain; one whose clock runs while
// the floor does not reads a gain with no travel.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { SURGE_DEFS } from "../constants";
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
 * The real time the window is measured over: a second and a half.
 *
 * Geometry rather than a tolerance. A Mote's specified `60` logical units per
 * second (`specs/surge.md`) carries it `90` units in that time, and a conformant
 * clock gains `1.5` seconds — several times both bounds below.
 */
const WINDOW_MS = 1500;

/**
 * How far the Mote must travel across the window: `20` logical units.
 *
 * Derived from the `90` a specified Mote covers in it: a build running at a third
 * of that pace, whether because it clamps its frame delta or because the machine
 * is loaded, still clears it. The claim being read is that the floor advances at
 * all; how FAST a Mote walks is `surge.*`'s requirement.
 */
const MIN_TRAVEL = 20;

/**
 * The least of the window that must really have elapsed: four fifths of it.
 *
 * A precondition on the HOST, not a bound on the build. `settle` schedules its own
 * halt and a machine under load can overrun or under-deliver; what would make the
 * readings below meaningless is a window that barely happened at all. It is the
 * same precondition the other two engines' copies of this point carry.
 */
const MIN_ELAPSED_MS = WINDOW_MS * 0.8;

/**
 * How much `simTime` must gain across the window: half a second.
 *
 * A third of the `1.5` seconds the window really spends, so the same third-pace
 * allowance applies to the clock as to the floor. It is five times the tenth of a
 * second `waves/pause-freezes-the-floor` allows a PAUSED clock to drift by, so a
 * game that is merely leaking a frame or two cannot pass here.
 */
const MIN_CLOCK_GAIN = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("walks the floor and gains simulation time with nothing stepping it", async () => {
  await startRun(h);
  const mote = await poseRunningFloor(h);

  await captureStill(h, "before");
  const openedAt = Date.now();
  const legs = await h.withOwnClock(async (clock) => {
    const opened = await clock.read();
    await clock.settle(WINDOW_MS);
    return { opened, settled: await clock.read() };
  });
  const elapsedMs = Date.now() - openedAt;
  await captureStill(h, "after");

  const at = (snapshot: typeof legs.opened) =>
    requireUnit(snapshot, mote, "the window on the build's own clock");

  assertGreaterThanOrEqual(
    elapsedMs,
    MIN_ELAPSED_MS,
    "precondition: the real window the build's own loop was given",
  );
  assertGreaterThan(
    distance(at(legs.opened), at(legs.settled)),
    MIN_TRAVEL,
    `the units a Mote at its specified ${SURGE_DEFS.mote.speed} a second travelled while the build drove its own clock`,
  );
  assertGreaterThan(
    legs.settled.simTime - legs.opened.simTime,
    MIN_CLOCK_GAIN,
    `the seconds simTime gained across the same window of real time`,
  );
});
