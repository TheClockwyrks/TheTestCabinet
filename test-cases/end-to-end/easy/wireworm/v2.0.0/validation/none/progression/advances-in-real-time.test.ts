// progression/advances-in-real-time — the game runs on its own clock.
//
// `specs/progression.md`, The three phases of play: "Simulation time accumulates
// the delta of every update whatever the screen, and the phase timers run
// against that same delta, so a run left alone gives way from its banner to live
// play on the game's own clock." `specs/instrumentation.md` fixes the other end
// of it: `setAutoStep(true)` "returns it to running itself, which is how a build
// starts and how it is played", and `simTime` "accumulates every update's delta".
//
// EVERY OTHER POINT IN THIS SUITE DRIVES THE GAME BY HAND, so this is the one
// that reads whether a build has a working frame loop at all. Nothing steps it:
// a run is opened from the title, the game is handed back to its own animation
// frame for a stretch of REAL time, and the two readings are taken off what it
// did in the meantime. A build whose loop never advances the simulation — one
// that only ever moves when `advance` is called — answers with the simulation
// time it started with and a banner still up; a build that runs but never times
// its frames answers with a `simTime` of zero; a correct build answers with a
// couple of seconds accumulated and live play underway.
//
// THE TOLERANCE, AND WHY IT IS ONLY A FLOOR. A frame loop measures the real time
// between frames, so `REAL_MS` of wall clock is `REAL_MS` of game time — but a
// build that drops frames, that clamps a long delta, or that renders at half the
// display rate is conforming, and none of that is what this point is about. So
// the floor is not a frame rate: it is `BANNER_TIME` (`1.3` s), the one interval
// the specification puts in front of the run, which is the least simulation time
// a game that reached live play on its own can have accumulated. It is the
// figure the second reading turns on, so the two readings fail together rather
// than at different frame rates, and it is a world away from the zero a build
// whose loop never advances the simulation reports.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  startRunFromTitle,
  type Harness,
} from "../harness";

/**
 * How long the game is left to itself, in REAL milliseconds: comfortably more
 * than the `BANNER_TIME` (`1.3` s) the run opens behind, so a build running at
 * well under the display's rate still reaches live play inside it.
 */
const REAL_MS = 3000;

/**
 * The least simulation time that stretch must have accumulated, in seconds: the
 * banner the run opened behind, which is what a game that reached live play on
 * its own clock has necessarily run through.
 */
const MIN_SIM = BANNER_TIME;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("accumulates time and opens live play with nothing stepping it", async () => {
  await startRunFromTitle(h);

  const before = await h.snapshot();
  await captureStill(h, "before");
  assertEqual(
    before.phase,
    "banner",
    "precondition: the run opened on its level banner (specs/progression.md)",
  );

  await h.runFor(REAL_MS);

  const after = await h.snapshot();
  await captureStill(h, "after");
  assertGreaterThanOrEqual(
    after.simTime - before.simTime,
    MIN_SIM,
    `the simulation time accumulated over ${REAL_MS}ms of real time`,
  );
  assertEqual(
    after.phase,
    "active",
    `the phase ${REAL_MS}ms after the run opened on its ${BANNER_TIME}s banner`,
  );
});
