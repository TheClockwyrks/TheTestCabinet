// Meltdown — waves/game-runs-on-its-own-clock: with nothing stepping it, the
// game advances itself.
//
// `specs/waves.md`, The simulation advances itself: "The game advances by the
// elapsed time of every frame, multiplied by the game speed. Every rate in this
// specification is per second and is integrated against that game time, and
// `simTime` accumulates it."
//
// ================================ THE CLOCK RULE ============================
//
// ANY CHECK ABOUT WHETHER TIME PASSES IS MEASURED ON THE CLOCK THE PLAYER'S GAME
// ACTUALLY RUNS ON, NEVER THROUGH A STEPPING OPERATION, BECAUSE THE STEPPING
// OPERATION IS INSTRUMENTATION AND THE QUESTION IS ABOUT THE GAME.
//
// This is the one item in the group where the rule bites hardest, because the
// question IS the clock: does the game run when nobody is turning the handle? So
// nothing turns it. `windowOfRealTime` hands the frame loop and a `WallClock`
// back to the build (`harness.ts`, Windows on the build's own clock): the
// engine's own loop schedules its own frames off the host's frame callback and
// its clock measures them, exactly as in a browser. No frame is stepped across
// the window and no pose is made inside it.
//
// WHAT IS ASSERTED IS THAT TIME REACHED THE GAME, NOT ANY RATE. How fast a Mote
// walks is `surge.walks-at-its-speed` and how the speed toggle scales game time
// is `waves.speed-doubles-the-game-time`; a real window is at the mercy of the
// host's scheduler, so the bounds below are floors a build that runs at all
// clears by a wide margin, never figures the specification fixes.
//
// ============================================================================
//
// BOTH READINGS COME FROM THE ONE PAIR OF SNAPSHOTS the window is bracketed
// with, so the floor's travel and the clock's gain describe the same stretch of
// real time and nothing else. Both are read, because they are two failures: a
// build whose frame loop never runs gains no `simTime`, and a build that
// accumulates a clock without stepping its simulation gains `simTime` while the
// Mote stands still.
//
// THE TWO STILLS ARE THE EVIDENCE. One frame is drawn and kept as the window
// opens and the canvas is kept again as it closes, so a reviewer sees the same
// floor at the two ends of a stretch of real time in which nothing touched the
// game.
//
// THE ELAPSED TIME IS CHECKED AS A PRECONDITION, because a window that did not
// happen would make both readings meaningless; it is a fact about the host
// rather than about the build, which is why it is stated as a precondition and
// not as the point.
//
// WHAT EVERY WRONG MODEL READS. A build that only advances when something steps
// it gains no `simTime` and moves nothing; one that draws without simulating
// moves nothing; one whose loop runs but whose game ignores the frame's elapsed
// time gains no `simTime`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  clockGain,
  createHarness,
  startRun,
  windowOfRealTime,
  type Harness,
} from "../harness";
import { poseMote, travelled } from "./run";

/**
 * The window spent in REAL time: a second and a half.
 *
 * The same length as the legs the pause items spend, so what a reviewer sees
 * here and there is the same stretch of the game. At a Mote's specified `60`
 * logical units per second it is `90` units of travel and `1.5` seconds of
 * `simTime` for a build that runs at the wall clock's own pace.
 */
const WINDOW_MS = 1500;

/**
 * The least of the window that must really have elapsed: four fifths of it.
 *
 * A precondition on the host, not a bound on the build. The window schedules its
 * own halt, and a machine under load can be slow to take it back; what would
 * make the readings below meaningless is a window that barely happened at all.
 */
const MIN_ELAPSED_MS = WINDOW_MS * 0.8;

/**
 * The least `simTime` must gain: a quarter of a second.
 *
 * A sixth of the window. A build running at the wall clock's pace gains the
 * whole `1.5`; the floor leaves room for a frame loop that starts late, for a
 * build that clamps a long frame's delta, and for a host that gave the loop a
 * fraction of the time it asked for.
 */
const MIN_CLOCK_GAIN = 0.5;

/**
 * The least the Mote must travel: `20` logical units.
 *
 * A floor distance, a little over one `TILE` (`19`), and the same bar the pause
 * items hold their running legs to. A Mote covers it in a third of a second of
 * game time, so it follows from the `MIN_CLOCK_GAIN` above rather than adding a
 * requirement about speed.
 */
const MIN_TRAVEL = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("walks the floor and gains simTime over a window nothing stepped", async () => {
  startRun(h);
  const mote = poseMote(h);

  await h.advance(1);
  captureStill(h, "before");

  const openedAt = Date.now();
  const window = await windowOfRealTime(h, WINDOW_MS);
  const elapsedMs = Date.now() - openedAt;

  captureStill(h, "after");

  assertGreaterThanOrEqual(
    elapsedMs,
    MIN_ELAPSED_MS,
    "precondition: the real window the loop was given, in milliseconds",
  );
  assertGreaterThan(
    clockGain(window),
    MIN_CLOCK_GAIN,
    `the seconds of game time the build's own clock gained over ` +
      `${WINDOW_MS} ms of real time`,
  );
  assertGreaterThan(
    travelled(window, mote, "window"),
    MIN_TRAVEL,
    `the logical units the Mote walked over ${WINDOW_MS} ms of real time`,
  );
});
