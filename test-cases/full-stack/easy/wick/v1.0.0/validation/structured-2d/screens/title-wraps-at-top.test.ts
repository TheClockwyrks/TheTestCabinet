// Wick — screens/title-wraps-at-top: `up` on the first title item wraps the
// highlight to the last.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`":
// "`menuIndex` is `0` on arriving. `up` and `down` move the highlight by one
// item and wrap at both ends". The menu is `TITLE_ITEMS`, two items, so an
// `up` from `0` reads the last index, `1`.
//
// THE DRIVE. `reset` to the title screen, which arrives on index `0`, and one
// real `ArrowUp`. Nothing is pressed first, so the wrap is the only thing the
// reading can be about.
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

it("reads the last title item after ArrowUp on the first", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the press is made on");
  assertEqual(before.menuIndex, 0, "menuIndex before the press");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "wrap");

  assertEqual(after.screen, "title", "the screen after the wrapping press");
  assertEqual(
    after.menuIndex,
    LAST_ITEM,
    "menuIndex after ArrowUp past the top",
  );
});
