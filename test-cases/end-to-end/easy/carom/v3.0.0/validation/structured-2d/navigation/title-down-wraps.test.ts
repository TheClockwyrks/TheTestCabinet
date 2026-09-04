// Carom — navigation/title-down-wraps: ArrowDown on the last title item wraps to the first.
//
// One transition of the menu state machine specs/ui.md fixes. It starts from
// the title, which `reset()` restores with `menuIndex` at 0; `openTitle` settles
// that reset with one advanced frame before the first press, so a tap's edge
// cannot be consumed by a world the reset is leaving. Every key is a real key
// event dispatched at the target the engine listens on, so the action is raised
// by the binding the case declares, and the result is read back off the game's
// own state. The still is the frame the press left.
//
// The last entry is POSED with `setMenuIndex` rather than walked to with two
// arrow presses, so the ONE press this check makes is the wrapping one. Walking
// there would fail this point for a build whose ordinary down edge is broken,
// and that build's defect belongs to `title-down`.
//
// Nothing on the field is posed or removed. The title's world is the one `reset`
// arranges, and specs/ui.md advances nothing at all on the title, so no ball and
// no obstacle can move while this check runs.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps the title selection from the last item to the first", async () => {
  await openTitle(h);
  h.debug.setMenuIndex(TITLE_ITEMS.length - 1);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, TITLE_ITEMS.length - 1);

  await h.tap("ArrowDown");
  captureStill(h, "menu");

  assertEqual(h.snapshot().screen, "title");
  assertEqual(h.snapshot().menuIndex, 0);
});
