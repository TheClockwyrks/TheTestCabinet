// instrumentation/menu-index-reads-back — the selection `setMenuIndex` poses is
// the selection `snapshot().menuIndex` reports, for every item of the menu the
// current screen shows.
//
// THE RULE. `specs/instrumentation.md`, The screen and the menus:
// `setMenuIndex(index)` "Sets the selected item on the menu the current screen
// shows", and the snapshot carries `menuIndex`, "the selected item on the menu
// the current screen shows". `specs/controls.md` fixes what the menu IS: "The
// controls a screen carries are that screen's menu, in the order the table above
// gives them."
//
// WHY IT IS A `broken` POINT. Every keyboard point in `navigation/` poses a
// starting selection with this operation and reads the result back through the
// same field, so a build whose selection does not read back leaves the whole
// keyboard route deciding nothing.
//
// EVERY ITEM OF THE HUD'S MENU IS POSED, because a field read back once could be
// a constant and the HUD is the longest menu the case has — three items, so the
// middle one is neither the first nor the last and a build that clamps, wraps or
// ignores the argument reads a different number.
//
// EACH IS READ WITH NO FRAME BETWEEN THE POSE AND THE READING, so what is read is
// the pose rather than an update.
//
// WHAT THIS DOES NOT DECIDE. What the selection MEANS — that the selected item is
// drawn distinctly, that confirm activates it, that arriving on `playing` selects
// the first item — which are `presentation`'s and `navigation/`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports each posed menu selection back through snapshot", async () => {
  // The HUD's menu, which is the longest one the case carries.
  openTable(h);

  const read: { posed: number; reported: number }[] = [];
  for (let index = HUD_ITEMS.length - 1; index >= 0; index -= 1) {
    h.debug.setMenuIndex(index);
    read.push({ posed: index, reported: h.snapshot().menuIndex });
  }

  await h.advance(1);
  // Before the assertions, so a failing pose still leaves the picture of the
  // menu the last one selected.
  captureStill(h, "posed");

  for (const step of read) {
    assertEqual(
      step.reported,
      step.posed,
      `snapshot().menuIndex after setMenuIndex(${step.posed}) on the HUD's ` +
        `menu of ${HUD_ITEMS.length} items (specs/instrumentation.md)`,
    );
  }
});
