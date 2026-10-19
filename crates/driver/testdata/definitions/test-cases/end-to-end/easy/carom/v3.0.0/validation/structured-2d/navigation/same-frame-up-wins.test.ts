// Carom — navigation/same-frame-up-wins: a frame carrying both an up edge and a
// down edge moves up only.
//
// specs/ui.md, at the end of its keyboard section: when several of a menu's
// edges arrive on one frame, up is applied before down, so a frame carrying both
// moves up only. A build that reads its edges in the other order plays the same
// until the frame two arrive together, which is why this is its own point rather
// than a clause on `title-up` or `title-down`.
//
// THE SELECTION IS POSED ON THE MIDDLE ITEM, which is what makes the reading
// unambiguous: up alone reaches 0, down alone reaches 2, and both applied in
// turn come back to 1. So the expected 0 can only come from the up edge winning.
//
// Both keys are HELD before the frame is driven and released after it, so their
// two edges land in ONE input read; `tap` would run a frame between them and
// deliver two frames' worth of edges. `ArrowUp` and `ArrowDown` are the pair
// specs/ui.md binds to `p2-up` and `p2-down`.
//
// Nothing on the field is posed or removed. The title's world is the one `reset`
// arranges, and specs/ui.md advances nothing at all on the title, so no ball and
// no obstacle can move while this check runs.
//
// The keys are real key events dispatched at the target the engine listens on,
// so the actions are raised by the bindings the case declares. The still is the
// frame the two edges left.

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
const SOLO = TITLE_ITEMS.indexOf("SOLO");
const VERSUS = TITLE_ITEMS.indexOf("VERSUS");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves up only when both edges land on one frame", async () => {
  assertGreaterThan(TITLE_ITEMS.length, 2);
  await openTitle(h);
  h.debug.setMenuIndex(VERSUS);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, VERSUS);

  h.hold("ArrowUp");
  h.hold("ArrowDown");
  await h.advance(1);
  h.release("ArrowUp");
  h.release("ArrowDown");
  captureStill(h, "menu");

  const moved = h.snapshot();
  assertEqual(moved.screen, "title");
  assertEqual(moved.menuIndex, SOLO);
});
