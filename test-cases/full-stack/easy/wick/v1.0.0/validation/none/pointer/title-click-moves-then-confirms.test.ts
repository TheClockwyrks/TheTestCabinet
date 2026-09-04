// pointer/title-click-moves-then-confirms — a click takes the item it landed in
// rather than the one the highlight was on.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 2:
// "A primary press edge inside the rectangle of the item at `menuIndex` `i` sets
// `menuIndex` to `i`, playing `menu-move` if that changed it, and then takes
// that item exactly as `confirm` on it does." specs/ui.md ("`title`"):
// "`HOW TO PLAY` | Sets `screen = howto` and `menuIndex = 0`", the third item of
// `TITLE_ITEMS`, with "`menuIndex` is `0` on arriving" at the title. So a click
// in the third item's rectangle from `menuIndex` `0` moves the highlight and
// takes `HOW TO PLAY` in one gesture, and a build that confirmed the HIGHLIGHTED
// item instead would light the lamp.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `screen` and `menuIndex` off the
// snapshot the clicking frame left. `howto` is reachable from the title by no
// other item, so the screen alone says which item the click took, and
// specs/ui.md fixes the index the how-to screen is entered with.
//
// HOW THE SCENARIO IS DRIVEN. The title opens with the highlight on the FIRST
// item and the click lands in the THIRD, so the item under the pointer and the
// item under the highlight are different. `menuRects()` reports where this build
// drew them; the aim is the middle of the third rectangle, and the primary
// button is pressed there with exactly one frame between press and release.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { captureStill, clickAt, createHarness, type Harness } from "../harness";
import { assertHighlight, menuPoints, poseTitle } from "./stage";

/** The item clicked: `HOW TO PLAY`, the third of `TITLE_ITEMS`. */
const CLICKED = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters howto when a click lands in HOW TO PLAY from menuIndex 0", async () => {
  await poseTitle(h);
  const points = await menuPoints(h, TITLE_ITEMS.length, "for the title menu");

  const opened = await clickAt(h, points[CLICKED]!);
  await captureStill(h, "clicked");

  assertHighlight(
    opened,
    "howto",
    0,
    "after a click inside HOW TO PLAY's rectangle",
  );
});
