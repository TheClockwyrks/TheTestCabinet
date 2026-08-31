// instrumentation/debug-api — the debug and automation surface is present,
// whole, and live.
//
// specs/instrumentation.md: "the build installs the finished surface on
// `window.__kessler` as soon as the game has initialized. Every scenario
// driven from code reaches the game through it, so it is present and exactly
// as specified here." The operations it must carry are the ones the same file
// enumerates under "The operations" — under this engine the two clock
// operations included, because "nothing outside this build owns" the clock:
// "`setAutoStep(false)` stops the frame loop feeding the wall clock's delta
// time into the tick accumulator, so no tick runs until `step` runs one."
//
// THREE HALVES. The first is presence: the global installed, every operation a
// function. The second is that the surface is LIVE rather than hollow: "a pose
// changes the running game and snapshot reads the change back". The third is
// the clock, which every other suite in this project rests on: with autoStep
// off, real time passes and nothing moves, and a step runs whole ticks on
// demand. Whether each individual operation does exactly what its section
// states is the business of the per-operation points that follow — a surface
// that is missing or inert fails HERE, by name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  failSurface,
  HANDLE,
  openHarness,
  type Harness,
} from "../harness";
import { REQUIRED_OPS } from "./helpers";

/** Real time allowed to pass with the game off the clock, nothing advancing. */
const FROZEN_MS = 500;

let h: Harness;

/** Fail with the harness's own account of what is missing. */
function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it(`installs every operation its mode names on window.${HANDLE}, as functions`, async () => {
  requireSurface();
  const probed = await h.probe(REQUIRED_OPS);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed[op], "function", `window.${HANDLE}.${op}`);
  }
});

it("is live: a pose changes the running game and snapshot reads it back", async () => {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await h.debug.setScore(500);
  const posed = await h.snapshot();

  // The clock is really disconnected: the harness has already called
  // `setAutoStep(false)`, so real time is simply allowed to pass — a build
  // still feeding the wall clock into its accumulator resolves ticks while
  // this waits, and one that really disconnected does not move at all.
  assertEqual(posed.autoStep, false, "autoStep after setAutoStep(false)");
  await h.page.waitForTimeout(FROZEN_MS);
  const still = await h.snapshot();
  assertEqual(still.ticks, posed.ticks, "ticks with the clock disconnected");

  // And the game RUNS on demand: a stepped tick advances the game's own clock
  // over the posed session rather than over a copy the surface answered from.
  const after = await h.tick(1);
  await captureStill(h, "surface");

  assertEqual(posed.screen, "playing", "the posed screen, read back");
  assertEqual(posed.score, 500, "the posed score, read back");
  assertEqual(after.ticks, posed.ticks + 1, "ticks across one stepped tick");
  assertEqual(after.score, 500, "the posed score, held by the running game");
});
