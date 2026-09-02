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
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertTrue,
} from "../assert";
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
 * The game time the RUNNING leg covers, on the build's own clock: a second and a
 * half.
 *
 * Geometry rather than a tolerance — it says how long the leg is, not how far a
 * build may miss by. A Mote's specified `60` logical units per second
 * (`specs/surge.md`) carries it `90` units, four and a half tiles, in that much
 * game time: far more than any bound below.
 *
 * IT IS A LENGTH ON THE BUILD'S CLOCK RATHER THAN ON THE HOST'S, and that is what
 * makes the leg repeatable. Nothing steps the game across it — the whole item
 * rests on that — but a leg that spends a fixed stretch of WALL clock and then
 * asks how far the floor got is asking how many frames this machine handed the
 * page as much as it is asking about the build. A page starved by everything else
 * on a loaded runner gets through a fraction of them, and a build that clamps a
 * long frame's delta (this case's own reference clamps at a tenth of a second)
 * then covers a fraction of the game time the window really took, so a correct
 * build loses the point for the load on the machine that scored it. Closed on
 * `simTime` instead, the leg covers the same stretch of the game however long the
 * host takes to deliver it, and `PAUSE_MIN_TRAVEL` below follows from the
 * specification rather than from the runner.
 */
const RUNNING_LEG_SECONDS = 1.5;

/**
 * The real time the running leg is given to gain {@link RUNNING_LEG_SECONDS}: a
 * minute.
 *
 * A ceiling on the HOST, not a bound on the build. A build running at the wall
 * clock's pace closes the leg in a second and a half; one whose page is getting a
 * tenth of the frames takes fifteen and still closes it. Failing to close it at
 * all means the floor does not advance unless something steps it, which is
 * `waves/game-runs-on-its-own-clock`'s verdict rather than this item's, so it is
 * reported here as a precondition.
 */
const RUNNING_LEG_DEADLINE_MS = 60_000;

/**
 * The real time the PAUSED leg is spent over: as long as the running leg took, and
 * never less than a second and a half nor more than ten.
 *
 * A paused leg is the one window in this project that CANNOT be closed on the
 * build's own clock, because the whole claim is that the clock does not move. So
 * it is spent in real time — and giving it the real time the running leg beside it
 * needed is what keeps the two comparable on a machine of any speed: a floor that
 * kept running gets exactly as many frames to be caught in as the running leg got
 * to prove itself with. The floor keeps a busy host from shrinking the leg to
 * nothing; the ceiling keeps a build that never advances at all from spending a
 * minute here as well as on the leg before it. NEITHER can fail a correct build:
 * a longer paused window only gives a broken pause more room to show itself.
 */
const PAUSE_WINDOW_FLOOR_MS = 1500;
const PAUSE_WINDOW_CAP_MS = 10_000;

/**
 * How far the Mote must travel in the running leg: `20` logical units.
 *
 * Derived from the `90` a specified Mote covers in {@link RUNNING_LEG_SECONDS} of
 * game time: a build that walks at a third of its specified pace still clears it.
 * It is also five times PAUSE_MAX_DRIFT, so a build whose floor is frozen in BOTH
 * legs cannot reach it and pass.
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
 * it is a fifteenth of the `1.5` seconds the running leg gains.
 */
const PAUSE_MAX_CLOCK_DRIFT = 0.1;

/** The paused leg's real length, from the real time the running leg took. */
function pausedWindowMs(runningElapsedMs: number): number {
  return Math.min(
    Math.max(runningElapsedMs, PAUSE_WINDOW_FLOOR_MS),
    PAUSE_WINDOW_CAP_MS,
  );
}

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
      // The state the scope opened in, taken in the same crossing that handed
      // the clock back — see `OwnClock.opened` — so the running leg's travel is
      // measured from where the Mote stood at the handover and not from wherever
      // a round trip's worth of the build's own frames had carried it.
      const opened = clock.opened;
      const ran = await clock.gain(
        RUNNING_LEG_SECONDS,
        RUNNING_LEG_DEADLINE_MS,
      );
      await clock.press(BINDINGS.pause);
      // The ONE snapshot on the press. Both readings of the paused leg are taken
      // from it, so the pair spans the paused window and nothing else.
      const pressed = await clock.read();
      await clock.settle(pausedWindowMs(ran.elapsedMs));
      return { opened, ran, pressed, settled: await clock.read() };
    }),
  );

  const at = (snapshot: typeof legs.opened) =>
    requireUnit(snapshot, mote, "the two windows on the build's own clock");

  assertTrue(
    legs.ran.reached,
    `precondition: the build's own clock gained ${RUNNING_LEG_SECONDS} seconds ` +
      `with nothing stepping it, within ${RUNNING_LEG_DEADLINE_MS / 1000}s of ` +
      `real time — it gained ${(legs.pressed.simTime - legs.opened.simTime).toFixed(3)}`,
  );
  assertGreaterThan(
    distance(at(legs.opened), at(legs.pressed)),
    PAUSE_MIN_TRAVEL,
    `the units a Mote at its specified ${SURGE_DEFS.mote.speed} a second travelled across the ${RUNNING_LEG_SECONDS} seconds the build's own clock gained`,
  );
  assertEqual(
    legs.pressed.screen,
    "paused",
    "precondition: the pause key reached the game and paused it",
  );
  assertLessThan(
    distance(at(legs.pressed), at(legs.settled)),
    PAUSE_MAX_DRIFT,
    `the units the Mote drifted across a paused window of the same real length`,
  );
  assertLessThan(
    legs.settled.simTime - legs.pressed.simTime,
    PAUSE_MAX_CLOCK_DRIFT,
    "the seconds simTime gained across the paused window",
  );
});
