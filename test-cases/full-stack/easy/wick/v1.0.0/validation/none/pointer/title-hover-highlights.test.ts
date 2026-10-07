// pointer/title-hover-highlights — the pointer resting on the second title item
// moves the highlight onto it.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"): "Every
// screen that shows a vertical menu answers the pointer: `title`, `almanac`,
// `levelup`, `paused`, `fallen`, and `dawn`. Each item the menu currently shows
// occupies a rectangle on the stage ... On `title`, `levelup`, `paused`,
// `fallen`, and `dawn` that is every item of the menu, and the rectangle at
// position `i` belongs to the item at `menuIndex` `i`", and rule 1: "Hover. The
// pointer inside the rectangle of the item at `menuIndex` `i`, with `menuIndex`
// not `i`, sets `menuIndex` to `i`". specs/ui.md ("`title`") gives the menu
// `TITLE_ITEMS`, three items, with "`menuIndex` is `0` on arriving", so the
// second item is the one `menuIndex` `1` belongs to.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot: the
// highlight is a number the state carries, and specs/ui.md ("Presentation")
// fixes "no palette, no font, no layout, and no styling", so which item is drawn
// distinctly is the build's and the index is the specification's.
//
// HOW THE SCENARIO IS DRIVEN. The game opens on the title, so the menu is read
// straight off the screen it opens on. `menuRects()` reports where this build
// laid its three items out, and the pointer is moved to the MIDDLE of the second
// rectangle, which is a point inside it whatever shape the build gave it. No
// coordinate here is named by the check: the specification fixes no layout, so a
// stage point named by hand would be a point read off one build. The mouse is
// Chromium's own, and exactly one frame runs after the move, because the three
// pointer rules are "applied on every frame, after that frame's press edges and
// before its update".
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons, and the
// aim is inside the rectangle by construction.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, hoverAt, type Harness } from "../harness";
import { assertHighlight, menuPoints, poseTitle } from "./stage";

/** The item the pointer rests on: `THE ALMANAC`, the second of `TITLE_ITEMS`. */
const HOVERED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 1 with the pointer inside the second title item's rectangle", async () => {
  await poseTitle(h);
  const points = await menuPoints(h, TITLE_ITEMS.length, "for the title menu");

  const hovered = await hoverAt(h, points[HOVERED]!);
  await captureStill(h, "hover");

  assertHighlight(
    hovered,
    "title",
    HOVERED,
    "under a pointer inside the second title item's rectangle",
  );
});
