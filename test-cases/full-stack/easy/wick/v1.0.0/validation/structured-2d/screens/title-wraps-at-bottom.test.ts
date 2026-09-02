// Wick — screens/title-wraps-at-bottom: `down` on the last title item wraps
// the highlight to the first.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`": "`up` and
// `down` move the highlight by one item and wrap at both ends".
// `specs/controls.md`, "What each screen reads", says the same of the title
// row: "`up`, `down` move the highlight, wrapping at both ends". The menu is
// `TITLE_ITEMS`, two items, so the last index is `1` and a `down` there reads
// `0`.
//
// THE DRIVE. `reset` to the title screen, one `ArrowDown` onto the last item,
// read back as the precondition, then the `ArrowDown` that must wrap. The
// edge case is its own point: a build that moves the highlight correctly and
// clamps at the bottom fails here alone.
//
// THE TOLERANCE. None: an index is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";

/** The last item of the title menu (specs/ui.md, TITLE_ITEMS). */
const LAST_ITEM = TITLE_ITEMS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 after ArrowDown on the last title item", async () => {
  h.reset();
  const posed = await tap(h, "ArrowDown");
  assertEqual(posed.screen, "title", "the screen the press is made on");
  assertEqual(posed.menuIndex, LAST_ITEM, "menuIndex before the press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "wrap");

  assertEqual(after.screen, "title", "the screen after the wrapping press");
  assertEqual(after.menuIndex, 0, "menuIndex after ArrowDown past the bottom");
});
