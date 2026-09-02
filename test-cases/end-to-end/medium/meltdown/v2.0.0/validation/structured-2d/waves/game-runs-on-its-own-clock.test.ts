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
// nothing turns it. `windowOfClockGain` hands the frame loop and a `WallClock`
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
// THE WINDOW IS CLOSED ON THE BUILD'S CLOCK AND THE WALL CLOCK IS ONLY A
// DEADLINE. An earlier revision spent a fixed stretch of wall clock and then
// asked how much game time it had bought, which asks two questions at once — did
// the build advance itself, and did this machine give its loop the frames to do
// it in. The second is not about the build: a starved loop gets a handful of
// frames, each worth at most the `WallClock`'s hundred-millisecond clamp, and a
// correct build then loses the point for the load on the runner that scored it.
// So the window now closes when `simTime` has gained the seconds it names, and
// the deadline is what a build that never advances on its own runs out.
//
// WHAT EVERY WRONG MODEL READS. A build that only advances when something steps
// it gains no `simTime` and moves nothing; one that draws without simulating
// moves nothing; one whose loop runs but whose game ignores the frame's elapsed
// time gains no `simTime`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertTrue } from "../assert";
import {
  captureStill,
  clockGain,
  createHarness,
  startRun,
  windowOfClockGain,
  type Harness,
} from "../harness";
import { poseMote, travelled } from "./run";

/**
 * The window, measured on the BUILD'S OWN clock: a second and a half of game
 * time.
 *
 * The same length as the legs the pause items spend, so what a reviewer sees here
 * and there is the same stretch of the game. At a Mote's specified `60` logical
 * units per second it is `90` units of travel.
 *
 * THE WINDOW IS STILL SPENT IN REAL TIME — that is the item — BUT IT IS NOT
 * MEASURED AGAINST A STOPWATCH. What a fixed stretch of wall clock buys is
 * however many frames the host handed the loop, each worth at most the
 * `WallClock`'s hundred-millisecond clamp; on a runner with a hundred other
 * things on it a second and a half of wall clock can be five frames and half a
 * second of game time, and a floor stated against the wall clock then fails a
 * conformant build for the load on the machine that scored it. Closed on
 * `simTime` instead, the window covers the game time it names on any machine and
 * simply takes longer on a slow one — and what it still catches is the whole of
 * what the item asks: a build that advances only when something steps it never
 * gains the seconds at all.
 */
const WINDOW_SECONDS = 1.5;

/**
 * The real time the build is given to gain {@link WINDOW_SECONDS} on its own
 * clock: a minute.
 *
 * A ceiling on the HOST and the only wall clock left in the item. A build running
 * at the wall clock's pace closes the window in the second and a half it names;
 * one whose loop is getting a tenth of the frames takes fifteen and still closes
 * it. What a minute distinguishes is a build whose simulation never advances
 * unless something steps it, which does not close it at all.
 */
const WINDOW_DEADLINE_MS = 60_000;

/**
 * The least the Mote must travel: `20` logical units.
 *
 * A floor distance, a little over one `TILE` (`19`), and the same bar the pause
 * items hold their running legs to. A Mote covers it in a third of a second of
 * game time, so it follows from {@link WINDOW_SECONDS} above rather than adding a
 * requirement about speed — and because the window's length is the build's own
 * game time, it follows from the specification rather than from the machine.
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

  const window = await windowOfClockGain(h, WINDOW_SECONDS, WINDOW_DEADLINE_MS);

  captureStill(h, "after");

  assertTrue(
    window.reached,
    `the seconds of game time the build's own clock gained with nothing ` +
      `stepping it, within ${WINDOW_DEADLINE_MS / 1000}s of real time — it ` +
      `gained ${clockGain(window).toFixed(3)} of the ${WINDOW_SECONDS} asked for`,
  );
  assertGreaterThan(
    travelled(window, mote, "window"),
    MIN_TRAVEL,
    `the logical units the Mote walked across the ${WINDOW_SECONDS} seconds the ` +
      `build's own clock gained`,
  );
});
