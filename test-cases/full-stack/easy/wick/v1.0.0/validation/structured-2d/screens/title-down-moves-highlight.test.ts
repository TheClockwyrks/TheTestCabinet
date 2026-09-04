// Wick — screens/title-down-moves-highlight: `down` moves the title menu's
// highlight to the next item.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`":
// "`menuIndex` is `0` on arriving. `up` and `down` move the highlight by one
// item and wrap at both ends". `specs/controls.md` binds `down` to
// `ArrowDown` and `KeyS` and reads it as a press EDGE off `playing`, and the
// title menu's three items are `TITLE_ITEMS`, so index `0` moves to index `1`,
// `THE ALMANAC`.
//
// THE DRIVE. `reset` to the title screen, which the specification puts
// `menuIndex` `0` on, then one real `ArrowDown` dispatched at the engine's
// input seam and delivered by one frame. Nothing else is touched: a build
// with a broken `confirm` and a working `down` passes here and fails there.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";

/** The index one `down` from the top of the menu. */
const NEXT_ITEM = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 1 after one ArrowDown on the title screen", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the press is made on");
  assertEqual(before.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "down");

  assertEqual(after.screen, "title", "the screen after ArrowDown");
  assertEqual(after.menuIndex, NEXT_ITEM, "menuIndex after one ArrowDown");
});
