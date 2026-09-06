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
// a player's key does". Under this engine the hold is the harness's scripted
// clock, so "giving the clock back" has no counterpart here.
//
// THE READ. On the title, one frame with ArrowDown held: the frame drew (the
// render issued operations), the highlight moved, and `run.tick` is 0. Then a
// posed run and exactly `DRIVEN` frames: `run.tick` rose by exactly `DRIVEN`,
// nothing more and nothing less, whatever wall time passed. Nothing here
// waits on real time: every reading is of a scripted frame.

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

/** Frames the scenario advances on a posed run, each one tick on playing. */
const DRIVEN = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances the run only by the scenario's frames while menus answer", async () => {
  h.reset();
  const menu = await tap(h, "ArrowDown");
  assertGreaterThan(
    drawOps(h.lastCalls()),
    0,
    "drawing operations the title frame issued",
  );
  assertEqual(menu.menuIndex, 1, "menuIndex after ArrowDown on the title");
  assertEqual(menu.run.tick, 0, "run.tick on the title after the press");

  isolate(h);
  const posed = h.snapshot();
  const driven = await h.tick(DRIVEN);
  captureStill(h, "held");
  assertEqual(
    driven.run.tick - posed.run.tick,
    DRIVEN,
    `run.tick gained over ${DRIVEN} scripted frames`,
  );
});
