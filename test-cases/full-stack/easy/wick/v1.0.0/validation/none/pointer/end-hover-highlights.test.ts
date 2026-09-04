// pointer/end-hover-highlights — the pointer resting on `TITLE` moves the end
// screen's highlight onto it.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"): "Every
// screen that shows a vertical menu answers the pointer: `title`, `almanac`,
// `levelup`, `paused`, `fallen`, and `dawn` ... the rectangle at position `i`
// belongs to the item at `menuIndex` `i`", and rule 1: "The pointer inside the
// rectangle of the item at `menuIndex` `i`, with `menuIndex` not `i`, sets
// `menuIndex` to `i`". specs/ui.md ("`fallen` and `dawn`"): "Menu | `END_ITEMS`:
// `TRY AGAIN`, `TITLE`, in that order", with "`menuIndex` is `0` on arriving",
// so `TITLE` is the item `menuIndex` `1` belongs to.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot: the
// highlight is a number the state carries, and which item is drawn distinctly is
// the build's, since specs/ui.md fixes "no palette, no font, no layout, and no
// styling".
//
// HOW THE SCENARIO IS DRIVEN. An isolated night is ended fallen the real way:
// specs/world.md ends a run fallen when "`hp` is `0` or below" at the end of a
// tick, and `setHp` at `0` "ends the run fallen at the end of the next `playing`
// tick" (specs/instrumentation.md), so one tick reaches the end screen.
// `menuRects()` reports where this build drew the two items; the pointer is
// moved to the middle of the second, and exactly one frame runs after the move,
// because the pointer rules are "applied on every frame".
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons, and the
// aim is inside the rectangle by construction.

import { afterEach, beforeEach, it } from "vitest";
import { END_ITEMS } from "../constants";
import { captureStill, createHarness, hoverAt, type Harness } from "../harness";
import { assertHighlight, endFallen, menuPoints, night } from "./stage";

/** The item the pointer rests on: `TITLE`, the second of `END_ITEMS`. */
const HOVERED = END_ITEMS.indexOf("TITLE");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 1 with the pointer inside TITLE's rectangle on fallen", async () => {
  await night(h);
  await endFallen(h);
  const points = await menuPoints(
    h,
    END_ITEMS.length,
    "for the end screen's menu",
  );

  const hovered = await hoverAt(h, points[HOVERED]!);
  await captureStill(h, "hover");

  assertHighlight(
    hovered,
    "fallen",
    HOVERED,
    "under a pointer inside TITLE's rectangle on fallen",
  );
});
