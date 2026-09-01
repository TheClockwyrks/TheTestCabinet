// instrumentation/reset-keeps-clock-hold — `reset()` leaves the game off real
// time: under this engine the harness's clock keeps driving frame by frame,
// so `run.tick` stays 0 until the scenario advances it.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "What the runtime
// provides instead": "a clock that supplies its own deltas takes it off real
// time: a scenario pairs a `ConstantClock` of `1000 / 60` milliseconds with
// `engine.advance`"; "A render-free core. Game state advances from ticks and
// input alone, independent ... of wall-clock time". A reset "leaves the game
// indistinguishable from a freshly started session", so nothing a reset does
// may put the game back on the wall clock.
//
// THE READ. A run is posed and driven, reset, and a run posed again; real
// time is then allowed to pass with no frame advanced. A build that started a
// clock of its own inside `reset` (an interval, a frame callback, a
// `Date.now()` read in `update`) accumulates ticks in that wait; a conformant
// one holds `run.tick` at 0 until the scenario's own frames move it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/**
 * Real time allowed to pass with no frame advanced: long enough that a build
 * on its own clock would have run tens of ticks, short enough to cost nothing.
 */
const HELD_MS = 300;

/** Frames the scenario advances afterward, each one tick on playing. */
const DRIVEN = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the run at tick 0 after a reset until the scenario advances it", async () => {
  h.reset();
  h.debug.setScreen("playing");
  await h.tick(10);

  h.reset();
  h.debug.setScreen("playing");
  const posed = h.snapshot();
  await new Promise((done) => setTimeout(done, HELD_MS));
  const held = h.snapshot();
  const driven = await h.tick(DRIVEN);
  captureStill(h, "held");

  assertEqual(posed.run.tick, 0, "run.tick of the run posed after the reset");
  assertEqual(held.run.tick, 0, "run.tick after real time passed unadvanced");
  assertEqual(held.simTime, posed.simTime, "simTime after real time passed");
  assertEqual(driven.run.tick, DRIVEN, "run.tick after the scenario's frames");
});
