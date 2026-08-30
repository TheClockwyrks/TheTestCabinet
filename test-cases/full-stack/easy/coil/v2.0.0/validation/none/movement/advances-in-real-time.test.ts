// movement/advances-in-real-time — the game runs itself off its own frame loop.
//
// WHY THIS POINT EXISTS. Every other check in this project drives the simulation
// itself, through the surface's `advance`, which is blind to this claim: a build
// whose game never advances unless something steps it would answer all of them
// perfectly while a person who opened it watched a frozen board. So this one
// alone never advances the measured stretch. It hands the game back to its own
// loop with `setAutoStep(true)`, lets real time pass, takes the clock back, and
// reads what the build did with it.
//
// THAT IS THE WHOLE OF THE CONTRACT UNDER THIS ENGINE. Nothing outside an
// engineless build owns its loop: specs/overview.md gives the frame loop and the
// delta time it measures to the runtime the build writes, and
// specs/instrumentation.md puts `setAutoStep` on the surface so that loop can be
// stopped and started from outside. Handing it back is the only way to see it.
//
// TWO INDEPENDENT WITNESSES, because either alone is cheap to fake: the game's
// own accumulated `simTime`, which says the build integrated the seconds it
// measured, and the cells the head covered, which say the SIMULATION ran rather
// than a counter ticking up.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TICKS_PER_SECOND, type Cell } from "../constants";
import {
  arrangeStep,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** The real-time window the build's own loop is left to run for. */
const RUN_MS = 1000;

/**
 * The floor `simTime` must clear, in seconds. Half the window, deliberately
 * generous: the claim is that the game advances ITSELF, not that it keeps perfect
 * time, and a build that clamps a long frame (ordinary spiral-of-death
 * protection) legally loses some of it.
 */
const MIN_ADVANCE = RUN_MS / 1000 / 2;

/**
 * The cells the head must cover. A second is eight ticks and so eight cells; a
 * loop managing a quarter of real time still carries it two.
 */
const MIN_CELLS = TICKS_PER_SECOND / 4;

/** Where the chain is posed: a clear run far longer than the window can spend. */
const HEAD: Cell = { col: 3, row: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances on its own frame loop with nothing stepping it", async () => {
  const posed = await arrangeStep(h, { head: HEAD, dir: "right", length: 3 });
  const before = posed.snapshot;
  // The instant play begins: one frame of the live round, before the build's own
  // loop has been handed anything.
  await captureStill(h, "before");
  assertEqual(before.screen, "playing", "the screen the round runs on");

  await h.runFor(RUN_MS);

  const after = await h.snapshot();
  // The pair is the evidence: two frames of the same round, a second apart, with
  // nothing between them but the build's own loop. A build that never advanced
  // itself produces two identical pictures.
  await captureStill(h, "after");

  assertGreaterThan(
    after.simTime - before.simTime,
    MIN_ADVANCE,
    "seconds of game time the build's own loop accumulated",
  );
  assertGreaterThan(
    after.snake[0].col - before.snake[0].col,
    MIN_CELLS,
    "cells the head covered on the build's own clock",
  );
});
