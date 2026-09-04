// panels/a-split-press-chooses-nothing — a press and a release in different
// regions choose neither.
//
// `specs/controls.md`: "A choice takes both of its edges inside one region: the
// press and its release for a pointer, the landing and the lift for a touch
// contact. Two edges falling in different regions, and an edge falling outside
// every region, choose nothing."
//
// WHY THIS IS ITS OWN POINT. It is the edge case of every pointer point in this
// category: a build that acts on the press alone passes each of those and fails
// only here, and a player who presses one menu item, thinks better of it and
// slides off before letting go has chosen nothing. The guide gives an edge case a
// validator of its own so a failed grade names it.
//
// THE READING IS THAT NOTHING HAPPENED. The press lands inside the title menu's
// second item and the release inside its first, so a build that acted on either
// edge would have left the title screen for somewhere else. The screen is still
// `title` afterwards. The highlight is NOT read: `specs/controls.md` has a
// pointer moved onto an item's region select it, so the highlight moving is
// exactly what a conformant build does while the contact travels — what must not
// happen is the CHOICE.
//
// WHERE THE TWO ITEMS ARE. `specs/overview.md` hands the layout to the build, so
// `specs/instrumentation.md`'s `menuItemRect(index)` reports each region and the
// two edges land in the middles of what the build named.
//
// ISOLATION. The title reached directly with the slot cleared, so the menu is the
// two-entry one specs/ui.md lists with no save banked. Nothing about an
// expedition is touched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { centerOf, menuItemRegion, splitPress } from "./mouse";

/** The two entries of the title menu with no save banked. */
const PRESSED_ON = 1;
const RELEASED_ON = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("chooses neither item when the press and the release land in different regions", async () => {
  h.debug.clearSave();
  h.debug.reset();
  h.debug.setScreen("title");
  await h.advance(1);

  const pressed = centerOf(menuItemRegion(h, PRESSED_ON));
  const released = centerOf(menuItemRegion(h, RELEASED_ON));
  await splitPress(h, pressed, released);
  captureStill(h, "split");

  assertEqual(
    h.snapshot().screen,
    "title",
    "specs/controls.md: two edges falling in different regions choose nothing",
  );
});
