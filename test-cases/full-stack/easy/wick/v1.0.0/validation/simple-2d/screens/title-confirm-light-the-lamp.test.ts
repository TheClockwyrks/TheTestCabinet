// screens/title-confirm-light-the-lamp — LIGHT THE LAMP starts a fresh run.
//
// WHAT THIS DECIDES. One thing: `confirm` on the title's first item leaves the
// game on `playing` with a fresh run. What a fresh run's every field holds is
// its own point (`fresh-run-state`); what this one adds is that the title's
// first entry is the door to it.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): "`LIGHT THE LAMP` | Starts a fresh run, defined
//   below, and sets `screen = playing`", with the menu's first item
//   `TITLE_ITEMS[0]` and "`menuIndex` is `0` on arriving".
//   specs/ui.md ("A fresh run"): "`LIGHT THE LAMP`, `TRY AGAIN`, and the debug
//   surface's `setScreen("playing")` each begin a fresh run ... the lamplighter
//   at the world origin `(0, 0)` with `hp = BASE_MAX_HP` (`100`) ... Taper at
//   level `1` alone in the first weapon slot", restated as `FRESH_RUN`.
//   specs/controls.md ("Actions and bindings"): `confirm` is `Enter`, `Space`.
//
// THE DRIVE, AND WHY THE FRAME IS SHORT. A reset to the title leaves the
// highlight on `LIGHT THE LAMP` with no key pressed, and one `Enter` is
// delivered on a frame of half a tick. "The frame's update then runs on the
// screen the edges left: a frame whose press enters `playing` ... runs that
// frame's ticks" (specs/controls.md), so a full frame would leave the run one
// tick old with the director's first window already spawned, and what this
// point reads is the run the transition itself produced. Half a tick delivers
// the same edge and consumes none, since "A tick is consumed while the
// accumulator is at least `TICK_DT − TICK_EPSILON`" (specs/instrumentation.md).
//
// THE TOLERANCE. None: a screen name and the fresh run's stored fields are
// exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { FRESH_RUN, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  runFields,
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

it("enters playing on a fresh run when the first title item is confirmed", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen Enter is pressed on");
  assertEqual(
    before.menuIndex,
    TITLE_ITEMS.indexOf("LIGHT THE LAMP"),
    "the highlight resting on LIGHT THE LAMP",
  );

  const after = await tapWithoutTick(h, "Enter");
  captureStill(h, "started");

  assertEqual(after.screen, "playing", "the screen Enter left the game on");
  assertDeepEqual(
    runFields(after.run),
    FRESH_RUN,
    "the run LIGHT THE LAMP started, as specs/ui.md's fresh run fixes it",
  );
});
