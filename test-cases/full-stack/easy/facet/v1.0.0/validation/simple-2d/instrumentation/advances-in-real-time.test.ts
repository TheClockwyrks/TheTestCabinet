// Facet — instrumentation/advances-in-real-time: with nothing stepping it from
// outside, the game advances its own simulation over real time.
//
// WHY THIS IS A POINT, AND WHY IT IS THE ONE THAT NEEDS A WALL CLOCK. Every
// other automated check in this project drives the game frame by frame, off a
// clock the harness owns. That is what makes them exact, and it is also what
// makes them blind to one whole failure: a build whose simulation runs only when
// something outside it says so. specs/overview.md gives the frame loop and the
// delta time to the engine and then says "Every rate in this specification is
// per second and every duration is in seconds, integrated against the delta time
// the runtime hands each update" — a game that never integrates the update it is
// handed never moves. A build that wired its resolution to the debug surface
// alone, or that raised a chain step from the pose that started it and never
// again, passes every driven check in this project and shows a frozen board to a
// player.
//
// SO THE ENGINE IS TURNED LOOSE. A chain is started, the harness stops stepping
// the game and starts the engine's own loop, and a stretch of REAL time passes.
// Then the game is asked where it got to.
//
// WHAT IS READ, AND WHY NOT `stepTimer` DIRECTLY. `simTime` "accumulates the
// delta time of every update, whatever the screen" (specs/instrumentation.md),
// so a game that ran at all has moved it. And the chain has to have moved WITH
// it, or a build that merely counts time while nothing responds to it would
// pass: the stretch is far longer than `STEP_SECONDS` (0.25), so specs/rules.md
// requires the board to have been read again and the step the swap resolved to
// be behind the game. `stepTimer` itself is not read as a figure, because where
// it stands afterwards depends on how many boundaries went by — which is the
// wall clock's business rather than the build's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotEqual } from "../assert";
import { quietRowsWithEscape } from "../board";
import { STEP_SECONDS } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * The stretch of real time the game is left to itself for.
 *
 * Comfortably longer than `STEP_SECONDS` (0.25), so even a loop that renders far
 * below the rate it would like still carries the chain past a step boundary
 * within it.
 */
const REAL_MS = 1000;

/** A board carrying one productive swap, and a spare so the round lives on. */
const POSED = quietRowsWithEscape([
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
]);

/** The swap that starts the chain: it completes a run of three rubies. */
const SWAP = { a: { col: 3, row: 3 }, b: { col: 3, row: 4 } };

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries a resolving chain forward over real time on its own", async () => {
  requireSurface();
  loadBoard(h, POSED);
  swap(h, SWAP.a, SWAP.b);
  // One frame, so the board the chain is running on has been drawn for the
  // still below.
  await h.advance(1);
  captureStill(h, "before");

  const before = h.snapshot();
  assertEqual(before.phase, "resolving", "the phase the accepted swap left");
  assertEqual(before.chainStep, 1, "the chain step the accepted swap resolved");

  // The harness lets go here: for the next stretch nothing outside the build
  // advances anything, and whatever happens is the build's own loop.
  await h.runFor(REAL_MS);

  const after = h.snapshot();
  captureStill(h, "after");

  // The simulation clock ran, so updates really happened.
  assertGreaterThan(
    after.simTime,
    before.simTime,
    `the simTime after ${REAL_MS}ms of real time`,
  );

  // And the chain went with it: more than `STEP_SECONDS` of game time passed, so
  // the board was read again and the step the swap resolved is behind the game —
  // either a further step is running or the chain has settled.
  assertNotEqual(
    after.chainStep,
    before.chainStep,
    `the chain step after ${REAL_MS}ms, which is past STEP_SECONDS (${STEP_SECONDS})`,
  );
});
