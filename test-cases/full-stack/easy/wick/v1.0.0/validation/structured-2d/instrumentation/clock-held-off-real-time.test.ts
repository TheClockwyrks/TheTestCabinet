// Wick — instrumentation/clock-held-off-real-time: with the wall clock held
// off the simulation, `run.tick` advances only when the scenario advances it,
// while the build keeps rendering frames and a menu still answers a key.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "What
// the runtime provides instead": "a clock that supplies its own deltas takes
// it off real time: a scenario pairs a `ConstantClock` of `1000 / 60`
// milliseconds with `engine.advance`, so one frame on `playing` consumes
// exactly one tick"; "a keyboard event dispatched at the engine's event target
// ... works the menus exactly as a player's key does". `specs/ui.md`, `title`:
// "`up` and `down` move the highlight by one item"; `specs/controls.md` binds
// `down` to `ArrowDown`. Under this engine the hold is the harness's scripted
// clock, so "giving the clock back" has no counterpart here.
//
// THE DRIVE. The title, one frame with ArrowDown held: the frame rendered
// (the pipeline issued draw calls), the highlight moved, and `run.tick` is 0.
// Then a posed run and exactly ten frames: `run.tick` rose by exactly ten,
// nothing more and nothing less, whatever wall time passed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  drawOps,
  isolate,
  tap,
  type Harness,
} from "../harness";

const RUN_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("advances run.tick only with the scenario while frames render and menus answer", async () => {
  h.reset();
  const title = await tap(h, "ArrowDown");
  assertGreaterThan(
    drawOps(h.lastCalls()),
    0,
    "draw calls the title frame issued",
  );
  assertEqual(title.menuIndex, 1, "menuIndex after ArrowDown on the title");
  assertEqual(title.run.tick, 0, "run.tick after a title frame");

  isolate(h);
  const before = h.snapshot();
  const after = await advanceTicks(h, RUN_TICKS);
  captureStill(h, "held");
  assertEqual(
    after.run.tick - before.run.tick,
    RUN_TICKS,
    `run.tick gained over ${RUN_TICKS} scripted frames`,
  );
});
