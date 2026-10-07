// pointer/paused-hover-highlights — the pointer resting on `MAIN MENU` moves the
// pause menu's highlight onto it.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"): "Every
// screen that shows a vertical menu answers the pointer: `title`, `almanac`,
// `levelup`, `paused`, `fallen`, and `dawn` ... the rectangle at position `i`
// belongs to the item at `menuIndex` `i`", and rule 1: "The pointer inside the
// rectangle of the item at `menuIndex` `i`, with `menuIndex` not `i`, sets
// `menuIndex` to `i`". specs/ui.md ("`paused`"): "the menu `PAUSE_ITEMS` below
// it: `RESUME`, `MAIN MENU`, in that order", with "`menuIndex` is `0` on
// arriving", so `MAIN MENU` is the item `menuIndex` `1` belongs to.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot: the
// highlight is a number the state carries, and which item is drawn distinctly is
// the build's, since specs/ui.md fixes "no palette, no font, no layout, and no
// styling".
//
// HOW THE SCENARIO IS DRIVEN. An isolated night is held under the pause screen
// through `setScreen("paused")`, which specs/instrumentation.md defines as
// setting `screen` and nothing else. `menuRects()` reports where this build drew the two
// items; the pointer is moved to the middle of the second, and exactly one frame
// runs after the move, because the pointer rules are "applied on every frame".
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons, and the
// aim is inside the rectangle by construction.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { captureStill, createHarness, hoverAt, type Harness } from "../harness";
import { assertHighlight, menuPoints, night, posePaused } from "./stage";

/** The item the pointer rests on: `MAIN MENU`, the second of `PAUSE_ITEMS`. */
const HOVERED = PAUSE_ITEMS.indexOf("MAIN MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 1 with the pointer inside MAIN MENU's rectangle", async () => {
  await night(h);
  await posePaused(h);
  const points = await menuPoints(h, PAUSE_ITEMS.length, "for the pause menu");

  const hovered = await hoverAt(h, points[HOVERED]!);
  await captureStill(h, "hover");

  assertHighlight(
    hovered,
    "paused",
    HOVERED,
    "under a pointer inside MAIN MENU's rectangle",
  );
});
