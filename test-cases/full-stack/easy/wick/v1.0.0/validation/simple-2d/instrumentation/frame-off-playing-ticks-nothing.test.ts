// instrumentation/frame-off-playing-ticks-nothing — on title, one scripted
// frame with ArrowDown held delivers the press edge, raises simTime by the
// frame's delta, and leaves run.tick at 0.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md: "On every other
// screen a frame ticks nothing and the accumulator holds `0`" and "`simTime`
// rises by every frame's delta time on every screen". specs/ui.md, "What
// advances on each screen": on `title`, "Nothing" but simTime and input.
// specs/controls.md: on `title`, "`up`, `down` move the highlight", `down`
// bound to `ArrowDown`, read as an edge.
//
// THE READ. A fresh reset, one frame with the key down. The highlight moved,
// which proves the frame ran and the edge was delivered; the run's tick did
// not; simTime rose by exactly the frame's TICK_DT.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, TICK_DT } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("delivers the edge and ticks nothing", async () => {
  h.reset();
  const before = h.snapshot();

  const after = await tap(h, "ArrowDown");
  captureStill(h, "title");

  assertEqual(after.screen, "title", "the screen after the frame");
  assertEqual(after.menuIndex, 1, "menuIndex after the ArrowDown frame");
  assertEqual(after.run.tick, 0, "run.tick after a title frame");
  assertEqual(after.accumulator, 0, "the accumulator off playing");
  assertWithin(
    after.simTime - before.simTime,
    TICK_DT,
    FIGURE_TOLERANCE,
    "simTime raised by the frame's delta",
  );
});
