// instrumentation/clock-held-off-real-time — with the wall clock held off the
// simulation by a scripted clock, `run.tick` advances only when the scenario
// advances it, while the build keeps rendering frames and a menu still answers
// a key press.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "What the runtime
// provides instead": "The engine advances the game frame by frame, and a clock
// that supplies its own deltas takes it off real time ... so one frame on
// `playing` consumes exactly one tick"; "A render-free core. Game state
// advances from ticks and input alone, independent of the canvas, of the frame
// loop that measured the delta time, and of wall-clock time"; and "a keyboard
// event dispatched at the engine's event target ... works the menus exactly as
// a player's key does".
//
// THE READ. Real time passes with no frame advanced and the run does not move;
// a frame then draws (the render issues operations) and moves the run by
// exactly the frames advanced; and on the title a real ArrowDown edge moves
// the highlight, the menu answering with the clock held.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  drawOps,
  isolate,
  tap,
  type Harness,
} from "../harness";

/** Real time allowed to pass with no frame advanced. */
const HELD_MS = 300;
/** Frames the scenario advances, each one tick on playing. */
const DRIVEN = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the run only by the scenario's frames", async () => {
  isolate(h);
  const posed = h.snapshot();
  await new Promise((done) => setTimeout(done, HELD_MS));
  const held = h.snapshot();
  assertEqual(held.run.tick, posed.run.tick, "run.tick after real time passed");
  assertEqual(held.simTime, posed.simTime, "simTime after real time passed");

  const { calls } = await h.frameDraw();
  assertGreaterThan(drawOps(calls), 0, "drawing operations the frame issued");
  const driven = await h.tick(DRIVEN - 1);
  captureStill(h, "held");
  assertEqual(
    driven.run.tick - posed.run.tick,
    DRIVEN,
    "run.tick after the frames",
  );

  h.reset();
  const menu = await tap(h, "ArrowDown");
  assertEqual(menu.menuIndex, 1, "menuIndex after ArrowDown on the title");
  assertEqual(menu.run.tick, 0, "run.tick on the title after the press");
});
