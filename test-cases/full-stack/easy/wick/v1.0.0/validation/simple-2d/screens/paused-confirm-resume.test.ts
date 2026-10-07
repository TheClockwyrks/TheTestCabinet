// screens/paused-confirm-resume — RESUME on paused returns to the run.
//
// WHAT THIS DECIDES. One thing: `confirm` on the pause menu's first item leaves
// the game on `playing` with the run exactly as the pause left it, so the night
// is picked up where it stopped rather than restarted. The same trip taken with
// `pause` is `paused-resume-via-key` and with `back` is `paused-back-resumes`;
// the menu's other item is `paused-confirm-main-menu`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): the item table, "`RESUME` | Sets `screen =
//   playing`, with the run untouched", with `PAUSE_ITEMS` "`RESUME`, `MAIN
//   MENU`, in that order", and "`menuIndex` is `0` on arriving ... `confirm`
//   takes the highlighted item".
//   specs/controls.md ("Actions and bindings"): `confirm` is `Enter`, `Space`,
//   read as an edge.
//   specs/instrumentation.md (`setScreen`): "`paused` | `playing` | Exactly as
//   `pause` does", which is how the pause is posed without pressing a key.
//
// THE DRIVE, AND WHY THE FRAME IS SHORT. An isolated `playing` run with a posed
// clock, a posed `hp`, and one enemy, paused through `setScreen("paused")`,
// where the highlight arrives on `RESUME` with no key pressed; then one `Enter`
// delivered on a frame of half a tick. A frame whose press enters `playing`
// "runs that frame's ticks" (specs/controls.md), so a full frame would leave
// the run one tick past the pause and this point could not tell a resumed run
// from an advanced one. Half a tick delivers the same edge and consumes none,
// since "A tick is consumed while the accumulator is at least `TICK_DT −
// TICK_EPSILON`" (specs/instrumentation.md), so what is read is the run the
// resume handed back.
//
// THE TOLERANCE. None: a screen name and the run's stored fields are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  runFields,
  spawnEnemyAt,
  tapWithoutTick,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing with the run the pause held", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", -120, 175);
  h.debug.setTick(5150);
  h.debug.setHp(47);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen Enter is pressed on");
  assertEqual(
    before.menuIndex,
    PAUSE_ITEMS.indexOf("RESUME"),
    "the highlight resting on RESUME",
  );

  const after = await tapWithoutTick(h, "Enter");
  captureStill(h, "resumed");

  assertEqual(after.screen, "playing", "the screen Enter left the game on");
  assertDeepEqual(
    runFields(after.run),
    runFields(before.run),
    "the resumed run, against the run the pause held",
  );
});
