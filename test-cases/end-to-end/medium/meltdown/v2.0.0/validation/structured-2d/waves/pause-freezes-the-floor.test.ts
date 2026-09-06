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
// Under this engine the rule has a specific reading, and `harness.ts` states it
// at length: `engine.advance(n)` is not an instrument bolted onto the game but
// the engine's OWN frame loop, running the identical frame a player's frame runs
// and handing the build the elapsed time the suite's clock answers. The build
// owns no loop it could gate separately, so there is nowhere for a pause to hide
// from it. `windowOfFrames` IS the player's clock here (`harness.ts`, Windows on
// the build's own clock), and the SHAPE of the measurement is what the rule
// still binds, every part of it load-bearing:
//
//   - TWO LEGS OF THE SAME LENGTH ON THE SAME UNIT. A running leg the Mote must
//     travel across, and a paused leg it must not. The running leg is what stops
//     a dead floor — a build that never moves anything — passing vacuously.
//   - BOTH PAUSED READINGS FROM THE ONE SNAPSHOT ON THE PRESS. The drift and the
//     simulated-clock gain come from the same pair of snapshots, so the pair
//     spans the paused window and nothing else. `windowOfFrames` takes one
//     snapshot at the call and one at the end, so the two cannot disagree.
//   - THE PAUSE IS PRESSED, NOT POSED. It goes through the key
//     `specs/controls.md` binds the action to, never `setScreen`, which "runs no
//     screen entry effect" (`specs/instrumentation.md`) and would announce the
//     answer.
//   - NOTHING STEPS THE GAME THROUGH THE DEBUG SURFACE, and no window is spent
//     against the wall clock: each leg is a stated number of frames of a stated
//     length, so the same game time lands on any machine.
//   - NON-ZERO TOLERANCES, deliberately: a build may resolve the injected key on
//     the frame after the one it arrived in.
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
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureReplay,
  clockGain,
  createHarness,
  startRun,
  ticksFor,
  windowOfFrames,
  type Harness,
} from "../harness";
import { poseMote, travelled } from "./run";

/** The key `specs/controls.md` binds the pause to. */
const PAUSE_KEY = BINDINGS.pause[0];

/**
 * The length of each leg: a second and a half of the build's own clock, in
 * frames of the suite's.
 *
 * Long enough that a Mote's specified `60` logical units per second carries it
 * some `90` units, nearly five tiles, so the running leg is unmistakable; short
 * enough that neither leg carries it anywhere near its exhaust. The same frames
 * of the same clock on any machine, so the game time each leg covers is the
 * specification's and nothing about the host.
 */
const WINDOW = ticksFor(1.5);

/**
 * The least the Mote must travel across the running leg: `20` logical units.
 *
 * A floor distance, a little over one `TILE` (`19`). A Mote at its specified
 * speed covers `90` across the game time the leg names, so the floor is under a
 * quarter of what the specification asks for and no build that moves its surge at
 * all is troubled by it. What it excludes is a floor that never moved, which
 * would otherwise pass the paused leg for the wrong reason.
 */
const MIN_TRAVEL = 20;

/**
 * The most the Mote may drift across the paused leg: `4` logical units.
 *
 * Not zero, and deliberately. A build may legally resolve an injected key on the
 * frame AFTER the one it arrived in, and a Mote covers half a unit in one frame
 * of the suite's `120` Hz clock. Four is eight such frames, a fifth of a tile,
 * and a twentieth of the `90` a running floor covers over the same window.
 */
const MAX_DRIFT = 4;

/**
 * The most `simTime` may gain across the paused leg: `0.1` seconds.
 *
 * The same allowance in the same units, twelve frames of the suite's clock,
 * against the `1.5` seconds a clock that kept running would gain.
 */
const MAX_CLOCK_DRIFT = 0.1;

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
    const running = await windowOfFrames(h, WINDOW);
    await h.tap(PAUSE_KEY);
    const screen = h.snapshot().screen;
    const paused = await windowOfFrames(h, WINDOW);
    return { running, paused, screen };
  });

  assertEqual(legs.screen, "paused", "precondition: the press paused the game");
  assertGreaterThan(
    travelled(legs.running, mote, "running leg"),
    MIN_TRAVEL,
    "the logical units the Mote walked across the running leg",
  );
  assertLessThan(
    travelled(legs.paused, mote, "paused leg"),
    MAX_DRIFT,
    "the logical units the Mote drifted across a paused leg of the same length",
  );
  assertLessThan(
    clockGain(legs.paused),
    MAX_CLOCK_DRIFT,
    "the seconds simTime gained across the paused leg",
  );
});
