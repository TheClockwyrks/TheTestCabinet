// pointer/title-hover-outside-inert — the pointer resting on no item leaves the
// highlight where it was.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 1:
// "Hover. The pointer inside the rectangle of the item at `menuIndex` `i`, with
// `menuIndex` not `i`, sets `menuIndex` to `i` and plays `menu-move`. The
// pointer inside no rectangle changes nothing." specs/ui.md ("`title`") gives
// the title `TITLE_ITEMS` with "`menuIndex` is `0` on arriving", so the
// highlight the pointer must leave alone is `0`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` and `screen` off the
// snapshot after the frame that read the pointer. A build that highlights
// whatever row the pointer is nearest, rather than the row it is inside, moves
// the highlight here and a build that answers the rectangles moves nothing.
//
// HOW THE SCENARIO IS DRIVEN. The resting point is DERIVED rather than named:
// `menuRects()` and `tabRects()` report every rectangle this build claims on the
// screen, and the harness sweeps the stage for a point inside none of them. The
// specification fixes no layout, so a hand-written "outside" point would be a
// point read off one build; a swept one is outside whatever layout the build
// chose. One frame runs after the move, because the pointer rules are "applied
// on every frame".
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons, and the
// resting point is outside every reported rectangle by construction.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverAt,
  pointerRest,
  rectIndexAt,
  menuRects,
  type Harness,
} from "../harness";
import { assertHighlight, poseTitle } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds menuIndex 0 with the pointer inside no title rectangle", async () => {
  await poseTitle(h);
  const rects = await menuRects(h);
  assertEqual(
    rects.length,
    TITLE_ITEMS.length,
    "the rectangles menuRects reports for the title menu",
  );
  const outside = await pointerRest(h);
  assertEqual(
    rectIndexAt(rects, outside),
    -1,
    "the title item the resting point lies inside, of which there is none",
  );

  const rested = await hoverAt(h, outside);
  await captureStill(h, "outside");

  assertHighlight(
    rested,
    "title",
    0,
    "under a pointer inside none of the title's rectangles",
  );
});
