// panels/pointer-hover-highlights-a-menu-item — a move alone moves the highlight.
//
// `specs/controls.md`: "A pointer moves onto a menu item's region: that item
// becomes the highlighted item, the one `menuIndex` reports." The move is not the
// press: nothing is chosen by it, and a build that only ever highlights what a
// press lands on fails here while passing every point about pressing.
//
// THE HIGHLIGHT STARTS SOMEWHERE ELSE, on the other entry of the two-item title
// menu, so `menuIndex` landing on the hovered item is a move rather than a value
// that was already there.
//
// WHERE THE ITEM IS. `specs/overview.md` hands the layout to the build, so
// `specs/instrumentation.md`'s `menuItemRect(index)` reports it and the pointer is
// moved to the middle of what the build named.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { hoverMenuItem } from "./mouse";

/**
 * The item the pointer moves onto, and the one the highlight starts on.
 *
 * `specs/ui.md` leads the title menu with `CONTINUE` only while a save exists, so
 * a cleared slot leaves the two-entry menu and these are its two indices.
 */
const HOVERED = 1;
const STARTS_ON = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("highlights the item the pointer moves onto", async () => {
  h.debug.clearSave();
  h.debug.reset();
  h.debug.setScreen("title");
  h.debug.setMenuIndex(STARTS_ON);
  await h.advance(1);

  await hoverMenuItem(h, HOVERED);
  captureStill(h, "hover");

  assertEqual(
    h.snapshot().menuIndex,
    HOVERED,
    "specs/controls.md: a pointer moved onto a menu item's region highlights it",
  );
});
