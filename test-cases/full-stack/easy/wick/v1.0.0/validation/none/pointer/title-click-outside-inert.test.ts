// pointer/title-click-outside-inert — a click that lands in no rectangle takes
// no item.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 2: "A
// primary press edge inside no rectangle does nothing." specs/ui.md ("`title`")
// gives the title `TITLE_ITEMS` with "`menuIndex` is `0` on arriving", so the
// screen and the highlight the click must leave alone are `title` and `0`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `screen` and `menuIndex` off the
// snapshot the clicking frame left. A build that takes the highlighted item on
// any press, rather than on a press inside an item's rectangle, lights the lamp
// here and leaves `playing`.
//
// HOW THE SCENARIO IS DRIVEN. The pressed point is DERIVED rather than named:
// `menuRects()` and `tabRects()` report every rectangle this build claims, and
// the harness sweeps the stage for a point inside none of them, which is the one
// point in this category no rectangle can supply. The primary button is pressed
// there with exactly one frame between press and release.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons, and the
// pressed point is outside every reported rectangle by construction.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  menuRects,
  pointerRest,
  rectIndexAt,
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

it("holds title with menuIndex 0 when a click lands in no rectangle", async () => {
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
    "the title item the pressed point lies inside, of which there is none",
  );

  const pressed = await clickAt(h, outside);
  await captureStill(h, "outside");

  assertHighlight(
    pressed,
    "title",
    0,
    "after a click inside none of the title's rectangles",
  );
});
