// navigation/pause-wraps — one up press on the first pause item wraps to the
// last.
//
// specs/ui.md: on `paused`, `p1-up` or `p2-up` moves `menuIndex` up one,
// wrapping from 0 to the last item, exactly as it does on the title. The pause
// menu is posed over an EMPTIED field with `reachPaused`, which leaves `menuIndex`
// at 0 — the first item, and the end this wraps from — so the ground is reached
// without pressing the key that opens the menu.
//
// One real `ArrowUp` is pressed and the snapshot is read back. `screen` is read
// as well as `menuIndex`: a build that treated the arrow as a confirm would
// resume the match rather than move the highlight, and reading both is what
// tells the two apart.
//
// The three-item title menu carries the wrap points for both ends
// (`title-up-wraps`, `title-down-wraps`); this is the one the pause menu's own
// shape earns.

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

it("wraps the pause selection from RESUME to QUIT TO MENU on an up press", async () => {
  assertEqual(PAUSE_ITEMS[PAUSE_ITEMS.length - 1], "QUIT TO MENU");
  await reachPaused(h, "versus");

  await h.tap("ArrowUp");
  await captureStill(h, "menu");

  const wrapped = await h.snapshot();
  assertEqual(wrapped.screen, "paused");
  assertEqual(wrapped.menuIndex, PAUSE_ITEMS.length - 1);
});
