// Carom — navigation/title-up-wraps: ArrowUp on the first title item wraps to
// the last.
//
// One transition of the menu state machine specs/ui.md fixes, in one direction:
// the up edge's wrap, which is its own edge case and so its own point. The title
// is posed by `openTitle`, which is `reset`, and `reset` leaves `menuIndex` at
// `0` (specs/state.md) — the item this wrap runs off the top of — so the
// precondition is read back off the snapshot rather than pressed for.
//
// The field is left exactly as the title state holds it. Nothing advances on
// `title` (specs/ui.md) and what is read is `screen` and `menuIndex`, which no
// ball and no obstacle can touch, so there is no bystander to remove. No paddle
// is taken: a menu is not driven through one.
//
// The key is a real key event dispatched at the target the runtime listens on,
// so the action is raised by the binding the case declares. The still is the
// frame the press left.

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

it("wraps the title selection from the first item to the last", async () => {
  openTitle(h);
  const opened = h.snapshot();
  assertEqual(opened.screen, "title");
  assertEqual(opened.menuIndex, 0);

  await h.tap("ArrowUp");
  captureStill(h, "menu");

  const wrapped = h.snapshot();
  assertEqual(wrapped.screen, "title");
  assertEqual(wrapped.menuIndex, TITLE_ITEMS.length - 1);
});
