// Carom — navigation/title-up: one ArrowUp on the title moves the selection up one.
//
// One transition of the menu state machine specs/ui.md fixes. It starts from
// the title, which `reset()` restores with `menuIndex` at 0; `openTitle` settles
// that reset with one advanced frame before the first press, so a tap's edge
// cannot be consumed by a world the reset is leaving. The last entry is then
// POSED with `setMenuIndex`, which is the "on the title with `menuIndex` 2" this
// point names, rather than walked to with down presses — a build whose down edge
// is broken fails `title-down` and still has this point graded on the edge it is
// about. Every key is a real key event dispatched at the target the engine
// listens on, so the action is raised by the binding the case declares, and the
// result is read back off the game's own state. The still is the frame the press
// left.
//
// Nothing on the field is posed or removed. The title's world is the one `reset`
// arranges, and specs/ui.md advances nothing at all on the title, so no ball and
// no obstacle can move while this check runs.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const VERSUS = TITLE_ITEMS.indexOf("VERSUS");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title selection from the last item to the second", async () => {
  assertGreaterThan(TITLE_ITEMS.length, 2);
  await openTitle(h);
  h.debug.setMenuIndex(HOWTO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, HOWTO);

  await h.tap("ArrowUp");
  captureStill(h, "menu");

  const moved = h.snapshot();
  assertEqual(moved.screen, "title");
  assertEqual(moved.menuIndex, VERSUS);
});
