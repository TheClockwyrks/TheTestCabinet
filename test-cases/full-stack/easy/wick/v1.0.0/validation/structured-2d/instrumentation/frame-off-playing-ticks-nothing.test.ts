// Wick — instrumentation/frame-off-playing-ticks-nothing: on `title`, one
// scripted frame with ArrowDown held delivers the press edge, raises `simTime`
// by the frame's delta, and leaves `run.tick` at 0.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, "A
// deterministic core": "On every other screen a frame ticks nothing and the
// accumulator holds `0`" and "`simTime` rises by every frame's delta time on
// every screen". `specs/ui.md`, `title`: "`up` and `down` move the highlight by
// one item"; `specs/controls.md`: `ArrowDown` is `down`, a press edge off
// `playing`.
//
// THE DRIVE. `reset` to the title, then exactly one frame of the harness's
// `TICK_DT` clock with the key held (`tap`). `REAL_EPS` on `simTime`, one
// stated real.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TICK_DT } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the highlight, adds the delta to simTime, and ticks nothing", async () => {
  h.reset();
  const before = h.snapshot();
  const after = await tap(h, "ArrowDown");
  captureStill(h, "title");

  assertEqual(after.menuIndex, 1, "menuIndex after the frame");
  assertNear(
    after.simTime - before.simTime,
    TICK_DT,
    REAL_EPS,
    "simTime gained by one title frame",
  );
  assertEqual(after.run.tick, 0, "run.tick after a title frame");
  assertEqual(after.accumulator, 0, "accumulator on title");
});
