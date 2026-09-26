// waves/game-runs-on-its-own-clock — the elapsed time of every frame reaches the
// simulation: the floor advances and `simTime` gains by exactly what the frames
// carried.
//
// specs/waves.md, The simulation advances itself: "The game advances by the elapsed
// time of every frame, multiplied by the game speed. Every rate in this
// specification is per second and is integrated against that game time, and
// `simTime` accumulates it."
//
// ================================ THE CLOCK RULE ============================
//
// A CHECK ABOUT WHETHER TIME PASSES IS MEASURED ON THE CLOCK THE PLAYER'S GAME
// RUNS ON, AND UNDER THIS ENGINE THAT CLOCK IS THE ENGINE'S OWN FRAME LOOP.
// `engine.advance(n)` runs the identical `update` a player's frame runs, handing
// the build each frame's elapsed milliseconds from the clock the harness opened
// the engine with; the build owns `update` and nothing else, so there is no loop
// of its own for the elapsed time to go missing in. `overWindow` therefore IS the
// player's clock here, and the item reads what the build did with the elapsed
// time it was handed.
//
// THE WINDOW IS A STATED NUMBER OF FRAMES OF A STATED LENGTH, never a stretch of
// wall clock. The suite's `ConstantClock` answers the same milliseconds for every
// frame on every machine, so the game time this window carries is the same on an
// idle runner and on one running a hundred other things, and the figure below is
// compared against what the specification says that game time must reach.
//
// ============================================================================
//
// TWO READINGS OF THE ONE CLAIM, BOTH FROM THE ONE PAIR OF SNAPSHOTS `overWindow`
// brackets the window with. The clock gain says the frames' elapsed time reached
// `simTime`; the Mote's travel says it reached the simulation the field is meant
// to be accumulating. They are two failures: a build that counts a clock without
// stepping its floor gains `simTime` while the Mote stands still, and a build
// that walks its surge off a clock of its own while ignoring the frame's delta
// moves the Mote while `simTime` stays put.
//
// THE TWO STILLS ARE THE EVIDENCE. The floor is kept as the window opens and again
// as it closes, so a reviewer sees the same floor at the two ends of a stretch of
// game time in which nothing but the frames touched the game.
//
// WHAT EVERY WRONG MODEL READS. A build whose game ignores the frame's elapsed
// time gains no `simTime`; one that advances a fixed step per frame regardless of
// the delta gains a different figure from the one the frames carried; one that
// draws without simulating moves nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  overWindow,
  seconds,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { poseMote } from "./run";

/**
 * The window: a second and a half of game time, in frames of the suite's clock.
 *
 * The same length as the legs the pause items spend, so what a reviewer sees here
 * and there is the same stretch of the game. At a Mote's specified `60` logical
 * units per second it is `90` units of travel.
 */
const WINDOW_SECONDS = 1.5;
const WINDOW = ticksFor(WINDOW_SECONDS);

/**
 * How far `simTime`'s gain may fall from the game time the frames carried: a
 * hundredth of a second.
 *
 * specs/waves.md makes `simTime` the accumulation of every frame's elapsed time,
 * so a conformant build gains exactly the `1.5` seconds the window's frames were
 * worth. A hundredth is a frame and a fraction of the suite's `120` Hz clock,
 * which covers a build that opens its accumulation on the frame after the one
 * the window opened on, and it is a hundred and fifty times smaller than the
 * window it is measured against.
 */
const CLOCK_TOLERANCE = 0.01;

/**
 * The least the Mote must travel: `20` logical units.
 *
 * A floor distance, a little over one `TILE` (`19`), and the same bar the pause
 * items hold their running legs to. A Mote covers it in a third of a second of
 * game time, so it follows from {@link WINDOW_SECONDS} above rather than adding a
 * requirement about speed, which is `surge.walks-at-its-speed`'s.
 */
const MIN_TRAVEL = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("walks the floor and gains the game time its frames carried", async () => {
  startRun(h);
  const mote = poseMote(h);

  await h.advance(1);
  captureStill(h, "before");

  const window = await overWindow(h, WINDOW);

  captureStill(h, "after");

  assertBetween(
    window.clockGain,
    seconds(WINDOW) - CLOCK_TOLERANCE,
    seconds(WINDOW) + CLOCK_TOLERANCE,
    `the seconds of game time simTime gained across ${WINDOW} frames worth ` +
      `${WINDOW_SECONDS} seconds (specs/waves.md: simTime accumulates the ` +
      "elapsed time of every frame)",
  );
  assertGreaterThan(
    window.travel(mote),
    MIN_TRAVEL,
    `the logical units the Mote walked across the ${WINDOW_SECONDS} seconds of ` +
      "game time the frames carried",
  );
});
