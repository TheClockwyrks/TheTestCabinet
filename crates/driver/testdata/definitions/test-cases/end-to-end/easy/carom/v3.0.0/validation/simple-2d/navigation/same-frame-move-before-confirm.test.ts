// Carom — navigation/same-frame-move-before-confirm: a frame carrying a movement
// edge and a confirm edge moves only.
//
// specs/ui.md, at the end of its keyboard section: when several of a menu's
// edges arrive on one frame, movement is applied before `confirm`, and a frame
// carrying both moves only. So the title has to still be showing afterwards, on
// the entry the movement reached.
//
// Reading both halves is the point. `menuIndex` at 1 says the movement was
// applied; `screen` still `title` says the confirm on that same frame was not. A
// build that confirmed first would have opened a Solo countdown from `menuIndex`
// 0, and one that applied both would be on VERSUS's countdown — neither of which
// passes.
//
// Both keys are HELD before the frame is driven and released after it, so their
// two edges land in ONE input read; `tap` would run a frame between them.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `title` (specs/ui.md) and what is read is `screen` and `menuIndex`, which no
// ball and no obstacle can touch, so there is no bystander to remove.
//
// The keys are real key events dispatched at the target the runtime listens on,
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

it("moves the selection and confirms nothing when both edges land on one frame", async () => {
  assertGreaterThan(TITLE_ITEMS.length, 1);
  openTitle(h);
  h.debug.setMenuIndex(SOLO);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title");
  assertEqual(posed.menuIndex, SOLO);

  h.hold("ArrowDown");
  h.hold("Enter");
  await h.advance(1);
  h.release("ArrowDown");
  h.release("Enter");
  captureStill(h, "menu");

  const moved = h.snapshot();
  assertEqual(moved.screen, "title");
  assertEqual(moved.menuIndex, VERSUS);
});
