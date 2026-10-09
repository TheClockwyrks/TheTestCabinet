// navigation/pause-down — one down press moves the pause selection from RESUME
// to RESTART.
//
// specs/ui.md: on `paused`, `p1-down` or `p2-down` moves `menuIndex` down one,
// exactly as it does on the title. The pause menu is posed over a live match
// with `reachPaused`, which sets what specs/ui.md says a `pause` edge sets —
// `resumeScreen = playing` and `menuIndex = 0` — so the ground is reached
// without pressing the key that opens the menu, which is the pause category's
// point.
//
// One real `ArrowDown` is pressed and the snapshot is read back. `screen` is
// read as well as `menuIndex`: a build that treated the arrow as a confirm would
// leave `paused` for `playing` while landing on the right index by accident, and
// reading both is what tells the two apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { reachPaused } from "./screens";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the pause selection to RESTART with one down press", async () => {
  assertEqual(PAUSE_ITEMS[1], "RESTART");
  await reachPaused(h, "versus");

  await h.tap("ArrowDown");
  await captureStill(h, "menu");

  const moved = await h.snapshot();
  assertEqual(moved.screen, "paused");
  assertEqual(moved.menuIndex, 1);
});
