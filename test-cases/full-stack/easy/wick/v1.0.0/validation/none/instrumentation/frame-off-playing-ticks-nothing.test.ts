// Wick — instrumentation/frame-off-playing-ticks-nothing: on `title`, one
// stepped frame with `ArrowDown` held delivers the press edge, raises `simTime`
// by the frame's delta, and leaves `run.tick` at `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `step(ticks)`):
// "Each frame is exactly a frame of the loop: it reads the keys as they stand,
// the held movement values and the press edges, runs the screen's update, then
// renders ... On every other screen the update ticks nothing: the menu edges
// are read, the loops are reconciled, `muted` is mirrored, and `run.tick` is
// untouched. `simTime` rises by `TICK_DT` per frame on every screen."
// specs/controls.md: on `title`, "`up`, `down` move the highlight". So the one
// frame moves `menuIndex` from `0` to `1`, adds `TICK_DT` to `simTime`, and
// leaves the run clock at `0`.
//
// WHY THE WORLD IS POSED AS IT IS. The title is where a reset leaves the game,
// with `menuIndex` `0` and a two-item menu, so one `down` edge is visible as a
// `1`; the key is held through a real tap, which is down, one frame, up. The
// frame is bracketed inside the page, because the same document leaves the
// build's own loop running in real time while the clock is held and has
// `simTime` rise by the delta of every frame it runs, so a reading taken across
// two crossings would count those frames too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { TICK_DT, TIMER_TOL } from "../constants";
import { bracket, captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs a title frame that reads the press edge and ticks nothing", async () => {
  // A tap: the key down, exactly one frame, the key up.
  const { before, after } = await bracket(h, "step", [1], {
    hold: "ArrowDown",
  });
  await captureStill(h, "title");

  assertEqual(before.screen, "title", "the screen the frame runs on");
  assertEqual(before.menuIndex, 0, "menuIndex before the press");

  assertEqual(
    after.menuIndex,
    1,
    "menuIndex after one frame with ArrowDown held",
  );
  assertNear(
    after.simTime - before.simTime,
    TICK_DT,
    TIMER_TOL,
    "simTime the frame added",
  );
  assertEqual(after.run.tick, 0, "the run clock after a title frame");
});
