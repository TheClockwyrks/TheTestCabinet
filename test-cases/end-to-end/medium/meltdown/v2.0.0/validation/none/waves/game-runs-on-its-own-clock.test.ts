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
// THE WINDOW IS MEASURED ON THE BUILD'S CLOCK, NOT ON THE HOST'S. It is spent in
// real time — that is the point of the item — but its LENGTH is a gain in
// `simTime`, not a stretch of wall clock, and the wall clock survives only as a
// deadline. A page whose frame callback is being starved by everything else on
// the machine gets through fewer frames, and a build that clamps a long frame's
// delta (this case's own reference clamps at a tenth of a second, and
// `specs/waves.md` neither requires nor forbids it) then advances less game time
// than the window really took. Read against the wall clock that is a failing
// point charged to a correct build for the load on the runner; read against
// `simTime` it is simply a leg that took longer to close. What still fails is
// the only thing this item ever asked: a build whose simulation does not move
// unless something steps it never gains the seconds at all, and the deadline
// runs out.
//
// WHAT EVERY WRONG MODEL READS. A build that advances only when stepped never
// reaches the gain and fails on the deadline; one that draws an animation without
// advancing its simulation does the same; one whose clock runs while the floor
// does not reaches the gain and travels nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
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
 * How much of the build's own clock the window covers: a second and a half.
 *
 * Geometry rather than a tolerance, and it is the LENGTH of the leg rather than
 * a bound on it. A Mote's specified `60` logical units per second
 * (`specs/surge.md`) carries it `90` units over that much game time, whatever
 * number of real frames the host let the build spend producing it.
 */
const WINDOW_SECONDS = 1.5;

/**
 * The real time the build is given to gain {@link WINDOW_SECONDS} on its own
 * clock: a minute.
 *
 * A ceiling on the HOST, not a bound on the build, and the only wall clock left
 * in the item. A build running at the wall clock's pace closes the window in the
 * second and a half it names; a build on a machine handing its page a tenth of
 * the frames takes fifteen and still closes it. What a minute distinguishes is
 * the build whose simulation never advances unless something steps it, which
 * does not close it at all.
 */
const GAIN_DEADLINE_MS = 60_000;

/**
 * How far the Mote must travel across the window: `20` logical units.
 *
 * Derived from the `90` a specified Mote covers in {@link WINDOW_SECONDS} of game
 * time: a build walking at a third of that pace still clears it. The claim being
 * read is that the floor advances at all; how FAST a Mote walks is `surge.*`'s
 * requirement. Because the window's length is the build's own game time rather
 * than a stretch of wall clock, this figure follows from the specification and
 * from nothing about the machine.
 */
const MIN_TRAVEL = 20;

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
  const legs = await h.withOwnClock(async (clock) => {
    const opened = await clock.read();
    const gained = await clock.gain(WINDOW_SECONDS, GAIN_DEADLINE_MS);
    return { opened, gained, settled: await clock.read() };
  });
  await captureStill(h, "after");

  const at = (snapshot: typeof legs.opened) =>
    requireUnit(snapshot, mote, "the window on the build's own clock");

  assertTrue(
    legs.gained.reached,
    `simTime gained ${WINDOW_SECONDS} seconds within ${GAIN_DEADLINE_MS / 1000}s ` +
      `of real time with nothing stepping the game — it gained ` +
      `${(legs.settled.simTime - legs.opened.simTime).toFixed(3)}`,
  );
  assertGreaterThan(
    distance(at(legs.opened), at(legs.settled)),
    MIN_TRAVEL,
    `the units a Mote at its specified ${SURGE_DEFS.mote.speed} a second travelled ` +
      `across the ${WINDOW_SECONDS} seconds the build's own clock gained`,
  );
});
