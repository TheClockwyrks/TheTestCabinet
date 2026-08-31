// waves/pause-freezes-the-floor — while the game is paused, the floor does not
// advance.
//
// `specs/waves.md`, Pause and speed: "While the game is paused the simulation does
// not advance: nothing moves, no heat changes, no clock counts down, no unit is
// released, and `simTime` holds where it was."
//
// THIS IS MEASURED ON THE BUILD'S OWN CLOCK, AND THAT IS THE WHOLE POINT OF THE
// ITEM. A check that paused the game and then called the debug surface's
// `advance` would be measuring WHERE A BUILD PUTS ITS PAUSE GATE, not whether the
// floor freezes. `advance` bottoms out in an operation of an instrumentation
// surface, and a build is free to gate it separately from its own frame loop: one
// that holds the pause in the shell that drives the clock is equally conformant,
// and it would step straight through such a check while its real-time picture
// showed the Mote stopping dead — a verdict contradicting its own evidence. Worse
// in the other direction, a build whose pause menu opens over a floor that goes on
// running — the actual defect this item exists to catch — would pass outright
// whenever `advance` happened to be gated. So the clock is handed back to the
// build with `withOwnClock`, the pause is a REAL key pressed through Chromium, and
// nothing inside the scope calls `advance` or anything built on it.
//
// THE READING IS A CONTRAST OVER TWO WINDOWS OF THE SAME LENGTH, because a frozen
// floor and a floor that never moved look identical in one window:
//
//   - THE RUNNING LEG. Before the press, the Mote must travel more than
//     PAUSE_MIN_TRAVEL. This is what stops a dead build passing vacuously, and it
//     is not a second requirement smuggled in: without it the item would be
//     satisfied by a game that never advances at all.
//   - THE PAUSED LEG. After the press, its drift must stay under PAUSE_MAX_DRIFT
//     and `simTime` must gain less than PAUSE_MAX_CLOCK_DRIFT. Two readings of the
//     one claim, since a build could hold a position while its clock ran on, or
//     hold its clock while the floor slid.
//
// BOTH READINGS OF THE PAUSED LEG COME FROM THE ONE SNAPSHOT TAKEN ON THE PRESS,
// so the pair spans the paused window and nothing else. A second round trip there
// would bill its own latency to the freeze.
//
// THE TOLERANCES ARE NON-ZERO ON PURPOSE. The press and the reading are a round
// trip apart, and a build is free to resolve an injected key on its next frame
// rather than inside the event, so a conformant build may run one or two more
// frames after the key goes down. Each bound below says how many.
//
// THE FLOOR HOLDS ONE MOTE AND NOTHING ELSE. `poseRunningFloor` empties both
// rosters through `startRun`, leaves the world gate shut so no unit arrives beside
// it, and adds one walker with its motion on — so what a window measures is the
// game's own locomotion rather than a position this check wrote.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { BINDINGS, SURGE_DEFS } from "../constants";
import {
  captureReplay,
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
 * Geometry rather than a tolerance — it says how long a window is, not how far a
 * build may miss by. A Mote's specified `60` logical units per second
 * (`specs/surge.md`) carries it `90` units, four and a half tiles, in that time:
 * far more than any bound below, and short enough that two legs and their presses
 * cost only a few seconds of a suite's wall clock.
 */
const PAUSE_WINDOW_MS = 1500;

/**
 * How far the Mote must travel in the running leg: `20` logical units.
 *
 * Derived from the `90` a specified Mote covers in the window: a build that lost
 * two thirds of that window to a clamped frame delta, to the handover, or to a
 * frame rate a third of the usual would still clear it. It is also five times
 * PAUSE_MAX_DRIFT, so a build whose floor is frozen in BOTH legs cannot reach it
 * and pass.
 */
const PAUSE_MIN_TRAVEL = 20;

/**
 * How far the Mote may drift in the paused leg: `4` logical units.
 *
 * The pause and the position are read a round trip apart. A build that latches
 * the key in its event handler is frozen before the reading; a build that compares
 * held state at the top of its next frame runs one more frame first, which at
 * `60` units per second and a sixtieth of a second is one unit. Four units is four
 * such frames, and it is a twenty-second of the `90` a running window covers — so
 * a floor that keeps running cannot hide inside it.
 */
const PAUSE_MAX_DRIFT = 4;

/**
 * How much `simTime` may gain in the paused leg: a tenth of a second.
 *
 * The same argument on the clock rather than on the position. One late frame at
 * sixty frames a second is a sixtieth of a second, so a tenth is six of them, and
 * it is a fifteenth of the `1.5` seconds a running window gains.
 */
const PAUSE_MAX_CLOCK_DRIFT = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds the floor still across a paused window it walked across unpaused", async () => {
  await startRun(h);
  const mote = await poseRunningFloor(h);

  const legs = await captureReplay(h, "frozen", () =>
    h.withOwnClock(async (clock) => {
      const opened = await clock.read();
      await clock.settle(PAUSE_WINDOW_MS);
      await clock.press(BINDINGS.pause);
      // The ONE snapshot on the press. Both readings of the paused leg are taken
      // from it, so the pair spans the paused window and nothing else.
      const pressed = await clock.read();
      await clock.settle(PAUSE_WINDOW_MS);
      return { opened, pressed, settled: await clock.read() };
    }),
  );

  const at = (snapshot: typeof legs.opened) =>
    requireUnit(snapshot, mote, "the two windows on the build's own clock");

  assertGreaterThan(
    distance(at(legs.opened), at(legs.pressed)),
    PAUSE_MIN_TRAVEL,
    `the units a Mote at its specified ${SURGE_DEFS.mote.speed} a second travelled across the running window, on the build's own clock`,
  );
  assertEqual(
    legs.pressed.screen,
    "paused",
    "precondition: the pause key reached the game and paused it",
  );
  assertLessThan(
    distance(at(legs.pressed), at(legs.settled)),
    PAUSE_MAX_DRIFT,
    `the units the Mote drifted across the paused window of the same length`,
  );
  assertLessThan(
    legs.settled.simTime - legs.pressed.simTime,
    PAUSE_MAX_CLOCK_DRIFT,
    "the seconds simTime gained across the paused window",
  );
});
