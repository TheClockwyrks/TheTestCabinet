// Shatter — pointer/hover-selects: the mouse moving onto an entry highlights it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A pointer moves onto an entry's
// region | The highlight becomes that entry." Nothing else on that row: a move is
// not a press, so it selects and confirms nothing.
//
// THE GROUND IS POSED AND ONLY THE MOUSE IS DRIVEN. The title is reset with the
// highlight on `PLAY`, and the one thing that happens afterwards is a mouse move,
// so the index read back can have come from nowhere else. Walking the arrows onto
// the entry instead would fail this point for a broken down edge, which is
// `controls/menu-down-arrow`'s to report.
//
// WHERE THE ENTRY IS DRAWN IS THE BUILD'S, NOT THE CASE'S. The region comes from
// `menuItemRect` (`specs/instrumentation.md`) and the mouse is moved to its
// middle, so a build that lays its menu out any way it likes passes here, and one
// that reports a region it does not actually answer on fails.
//
// AND THE SCREEN IS READ BESIDE THE INDEX. A move selects and confirms nothing, so
// a build that fired the entry on the hover has left the title and fails here
// rather than passing on the index it set on the way out.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a click confirms (`pointer/click-confirms`),
// what the entry it lands on leads to (`screens/howto-reachable`), or how the
// title menu is drawn (`screens/title-menu-entries`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pointerOntoItem,
  type Harness,
} from "../harness";

/** The title's entries, by index (`specs/ui.md`, `TITLE_ITEMS`). */
const PLAY = 0;
const HOW_TO_PLAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("highlights the entry the mouse moves onto", async () => {
  assertEqual(
    TITLE_ITEMS[HOW_TO_PLAY],
    "HOW TO PLAY",
    "the title entry the mouse is moved onto",
  );

  h.debug.reset();
  h.debug.setMenuIndex(PLAY);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the mouse was moved on");
  assertEqual(posed.menuIndex, PLAY, "the entry the highlight was posed on");

  await pointerOntoItem(h, HOW_TO_PLAY);
  captureStill(h, "menu");

  const hovered = h.snapshot();
  assertEqual(
    hovered.menuIndex,
    HOW_TO_PLAY,
    "the entry the highlight moved to when the mouse arrived (specs/ui.md)",
  );
  assertEqual(
    hovered.screen,
    "title",
    "the screen a move alone left showing — a move confirms nothing (specs/ui.md)",
  );
});
