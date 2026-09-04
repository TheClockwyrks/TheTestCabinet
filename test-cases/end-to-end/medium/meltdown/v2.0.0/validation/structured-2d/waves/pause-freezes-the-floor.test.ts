// Meltdown — waves/pause-freezes-the-floor: while the game is paused the floor
// does not move, and the game's own clock does not run.
//
// `specs/waves.md`, Pause and speed: "While the game is paused the simulation
// does not advance: nothing moves, no heat changes, no clock counts down, no
// unit is released, and `simTime` holds where it was."
//
// ================================ THE CLOCK RULE ============================
//
// ANY CHECK ABOUT WHETHER TIME PASSES IS MEASURED ON THE CLOCK THE PLAYER'S GAME
// ACTUALLY RUNS ON, NEVER THROUGH A STEPPING OPERATION, BECAUSE THE STEPPING
// OPERATION IS INSTRUMENTATION AND THE QUESTION IS ABOUT THE GAME.
//
// The rule was bought with a defect in a previous version of this case, which
// decided this very item by pausing the game and then calling the debug API's
// own step. That measures WHERE A BUILD PUTS ITS PAUSE GATE, not whether the
// floor freezes: a build holding the pause in the shell that drives the clock is
// equally legal and stepped straight through the check while its real-time clip
// showed the Mote stopping dead, so the verdict contradicted its own evidence —
// and worse in the other direction, a build whose pause menu opened over a floor
// that kept running passed outright whenever the step happened to be gated.
//
// So NOTHING STEPS THE GAME HERE. `windowOfRealTime` hands the frame loop and a
// real-time clock back to the build (`harness.ts`, Windows on the build's own
// clock): the engine's own loop schedules its frames off the host's frame
// callback and its `WallClock` measures them, exactly as in a browser, and what
// the floor did over the window is the floor's. The shape of the measurement is
// the rest of the rule, and every part of it is load-bearing:
//
//   - TWO LEGS OF THE SAME LENGTH ON THE SAME UNIT. A running leg the Mote must
//     travel across, and a paused leg it must not. The running leg is what stops
//     a dead floor — a build that never moves anything — passing vacuously.
//   - BOTH PAUSED READINGS FROM THE ONE SNAPSHOT ON THE PRESS. The drift and the
//     simulated-clock gain come from the same pair of snapshots, so the pair
//     spans the paused window and nothing else. `windowOfRealTime` takes one
//     snapshot at the call and one at the end, so the two cannot disagree.
//   - THE PAUSE IS PRESSED, NOT POSED. It goes through the key
//     `specs/controls.md` binds the action to, never `setScreen`, which "runs no
//     screen entry effect" (`specs/instrumentation.md`) and would announce the
//     answer.
//   - NON-ZERO TOLERANCES, deliberately: the press and the position are read a
//     round trip apart.
//
// ============================================================================
//
// THE CLOCK IS READ AS WELL AS THE FLOOR, because they are two different
// failures: a build that stops drawing the surge while its simulation runs on
// holds the position and gains `simTime`, and a build that freezes the floor by
// other means while its clock counts on is a build whose pause is a coat of
// paint.
//
// THE UNIT IS A LONE MOTE ON A STRAIGHT OPEN ROW (`waves/run.ts`), with no tower
// on the floor: what moves it is its own locomotion and nothing else, and its
// route does not bend across either leg, so travel is distance walked.
//
// WHAT EVERY WRONG MODEL READS. A build whose pause menu opens over a running
// floor travels the running leg's distance again in the paused one; a build that
// freezes the floor but keeps its clock gains a second and a half of `simTime`;
// a build that never moves anything fails the running leg.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertTrue,
} from "../assert";
import { BINDINGS } from "../constants";
import {
  captureReplay,
  clockGain,
  createHarness,
  startRun,
  windowOfClockGain,
  windowOfRealTime,
  type Harness,
} from "../harness";
import { poseMote, travelled } from "./run";

/** The key `specs/controls.md` binds the pause to. */
const PAUSE_KEY = BINDINGS.pause[0];

/**
 * The length of the RUNNING leg: a second and a half of the BUILD'S OWN clock,
 * spent by the build's own loop.
 *
 * Long enough that a Mote's specified `60` logical units per second carries it
 * some `90` units, nearly five tiles, so the running leg is unmistakable; short
 * enough that it carries it nowhere near its exhaust.
 *
 * IT IS A LENGTH ON THE BUILD'S CLOCK RATHER THAN ON THE HOST'S. Nothing steps the
 * game across it — the rule above is the whole item — but a leg closed by a
 * STOPWATCH covers however much game time this machine's scheduler let the loop
 * produce, each frame worth at most the `WallClock`'s clamp. On a runner with a
 * hundred other things on it that is a fraction of what the same build produces
 * idle, so a floor bound read off such a leg fails a conformant build for the load
 * on the machine that scored it. Closed on `simTime` the leg covers the stretch of
 * the game it names on any machine, and takes longer on a slow one instead of
 * covering less.
 */
const WINDOW_SECONDS = 1.5;

/**
 * The real time the running leg is given to gain {@link WINDOW_SECONDS}: a minute.
 *
 * A ceiling on the HOST, not a bound on the build. A build running at the wall
 * clock's pace closes the leg in a second and a half, and one whose loop is
 * getting a tenth of the frames takes fifteen and still closes it. What a minute
 * distinguishes is a build whose simulation never advances unless something steps
 * it — `waves.game-runs-on-its-own-clock`'s verdict rather than this item's, so it
 * is reported here as a precondition.
 */
const WINDOW_DEADLINE_MS = 60_000;

/**
 * The real time the PAUSED leg is spent over: as long as the running leg took, and
 * never less than a second and a half nor more than ten.
 *
 * A paused leg is the one window that CANNOT be closed on the build's own clock,
 * because the whole claim is that the clock does not move. So it is spent in real
 * time — and giving it the real time the running leg beside it needed keeps the
 * two comparable on a machine of any speed: a floor that kept running gets exactly
 * as many frames to be caught in as the running leg got to prove itself with. The
 * floor keeps a busy host from shrinking the leg to nothing; the ceiling keeps a
 * build that barely advances from spending a minute here too. Neither can fail a
 * correct build — a longer paused window only gives a broken pause more room to
 * show itself.
 */
const PAUSED_FLOOR_MS = 1500;
const PAUSED_CAP_MS = 10_000;

/**
 * The least the Mote must travel across the running leg: `20` logical units.
 *
 * A floor distance, a little over one `TILE` (`19`). A Mote at its specified
 * speed covers `90` across the game time the leg names, so the floor is under a
 * quarter of what the specification asks for and no build that moves its surge at
 * all is troubled by it. Because the leg's length is the build's own game time
 * rather than a stretch of wall clock, the figure follows from the specification
 * and from nothing about the machine. What it excludes is a floor that never
 * moved, which would otherwise pass the paused leg for the wrong reason.
 */
const MIN_TRAVEL = 20;

/**
 * The most the Mote may drift across the paused leg: `4` logical units.
 *
 * Not zero, and deliberately. The press and the position are read a round trip
 * apart: a build may legally resolve an injected key on the frame AFTER the one
 * it arrived in, and a Mote covers a unit in a sixtieth of a second. Four is a
 * fifth of a tile, and a twentieth of the `90` a running floor covers over the
 * same window.
 */
const MAX_DRIFT = 4;

/**
 * The most `simTime` may gain across the paused leg: `0.1` seconds.
 *
 * The same allowance in the same units — about six frames of a sixty-a-second
 * loop — against the `1.5` seconds a clock that kept running would gain.
 */
const MAX_CLOCK_DRIFT = 0.1;

/** The paused leg's real length, from the real time the running leg took. */
function pausedWindowMs(runningElapsedMs: number): number {
  return Math.min(Math.max(runningElapsedMs, PAUSED_FLOOR_MS), PAUSED_CAP_MS);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the floor and the clock across a paused window it travelled the one before", async () => {
  startRun(h);
  const mote = poseMote(h);

  const legs = await captureReplay(h, "frozen", async () => {
    const running = await windowOfClockGain(
      h,
      WINDOW_SECONDS,
      WINDOW_DEADLINE_MS,
    );
    await h.tap(PAUSE_KEY);
    const screen = h.snapshot().screen;
    const paused = await windowOfRealTime(h, pausedWindowMs(running.ms));
    return { running, paused, screen };
  });

  assertEqual(legs.screen, "paused", "precondition: the press paused the game");
  assertTrue(
    legs.running.reached,
    `precondition: the build's own clock gained ${WINDOW_SECONDS} seconds with ` +
      `nothing stepping it, within ${WINDOW_DEADLINE_MS / 1000}s of real time — ` +
      `it gained ${clockGain(legs.running).toFixed(3)}`,
  );
  assertGreaterThan(
    travelled(legs.running, mote, "running leg"),
    MIN_TRAVEL,
    `the logical units the Mote walked across the ${WINDOW_SECONDS} seconds the ` +
      `build's own clock gained`,
  );
  assertLessThan(
    travelled(legs.paused, mote, "paused leg"),
    MAX_DRIFT,
    `the logical units the Mote drifted across a paused leg of the same real length`,
  );
  assertLessThan(
    clockGain(legs.paused),
    MAX_CLOCK_DRIFT,
    "the seconds simTime gained across the paused leg",
  );
});
