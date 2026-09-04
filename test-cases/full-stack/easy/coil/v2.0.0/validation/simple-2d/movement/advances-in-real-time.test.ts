// movement/advances-in-real-time — the game runs itself off a real wall clock.
//
// WHY THIS POINT EXISTS. Every other check in this project steps the runtime
// itself, a counted number of frames at deltas it chose, which is blind to this
// claim: a build that consumes nothing of the elapsed time it is handed, or that
// advances a fixed amount per frame, can answer all of them and still show a
// person who opened it a board that does not move at the rate it should. So this
// one alone never steps anything. It builds a runtime on the wall clock a shipped
// game runs under, hands the game to that runtime's own frame loop, lets real
// time pass, and reads what the build did with it.
//
// WHAT IS THE BUILD'S HERE. The loop and the clock are the engine's
// (specs/instrumentation.md), and what the build owes is the other half: taking
// the real elapsed seconds each update carries and consuming them into ticks, as
// specs/movement.md states. A build that ignores its `dtSeconds` reads the same
// under this check as one whose game never advances at all.
//
// TWO INDEPENDENT WITNESSES, because either alone is cheap to fake: the game's
// own accumulated `simTime`, which says the build integrated the seconds it was
// handed, and the cells the head covered, which say the SIMULATION ran rather
// than a counter ticking up.

import { afterEach, beforeEach, it } from "vitest";
import { WallClock } from "@test-cabinet/simple-2d";
import { assertEqual, assertGreaterThan } from "../assert";
import { TICK_SECONDS } from "../constants";
import {
  arrangeStep,
  captureStill,
  createHarness,
  type Cell,
  type Harness,
} from "../harness";

/** The real-time window the game is left running for. */
const RUN_MS = 1000;

/**
 * The floor `simTime` must clear, in seconds. Half the window, deliberately
 * generous: the claim is that the game advances on real time, not that it keeps
 * perfect time, and a runtime clamping a long frame legally loses some of it.
 */
const MIN_ADVANCE = RUN_MS / 1000 / 2;

/**
 * The cells the head must cover. A second is eight ticks and so eight cells; a
 * loop managing a quarter of real time still carries it two.
 */
const MIN_CELLS = Math.round(1 / TICK_SECONDS) / 4;

/** Where the chain is posed: a clear run far longer than the window can spend. */
const HEAD: Cell = { col: 3, row: 8 };

let h: Harness;

beforeEach(async () => {
  // The clock a shipped game runs under, rather than the counted one every other
  // check in this project drives: this is the only point that measures against
  // real elapsed time, so it is the only one that reads it.
  h = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  h?.dispose();
});

it("advances on real elapsed time with nothing stepping it", async () => {
  arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  // One frame, so the round has been drawn once and the reading below starts
  // from a game that is live rather than one that has never rendered.
  await h.advance(1);
  const before = h.snapshot();
  // The instant play begins: one frame of the live round, before the loop has
  // been handed any real time.
  captureStill(h, "before");
  assertEqual(before.screen, "playing", "the screen the round runs on");

  await h.runFor(RUN_MS);

  const after = h.snapshot();
  // The pair is the evidence: two frames of the same round, a second apart, with
  // nothing between them but the loop and the build's own update. A build that
  // consumed none of that time produces two identical pictures.
  captureStill(h, "after");

  assertGreaterThan(
    after.simTime - before.simTime,
    MIN_ADVANCE,
    "seconds of game time the build accumulated off the wall clock",
  );
  assertGreaterThan(
    after.snake[0].col - before.snake[0].col,
    MIN_CELLS,
    "cells the head covered over the real second",
  );
});
