// pointer/title-touch-confirms — a contact landing and lifting inside a title
// item's rectangle takes that item.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer and touch"),
// rule 3: "a contact landing and lifting inside the rectangle of the item at
// `menuIndex` `i` selects that item and takes it exactly as `confirm` on it
// does." specs/ui.md ("`title`"): "`HOW TO PLAY` | Sets `screen = howto` and
// `menuIndex = 0`", over the menu `TITLE_ITEMS`, whose third item it is.
//
// WHY `HOW TO PLAY` RATHER THAN `LIGHT THE LAMP`. The item this decides has to
// be one the contact had to move the highlight onto, so the taking cannot be
// read as the title's opening selection being confirmed; and the screen it
// leads to starts no run, so what is read is the taking alone rather than the
// fresh run a lit lamp brings with it, which is
// `pointer/title-click-confirms`'.
//
// HOW THE SCENARIO IS DRIVEN. A REAL contact landing at the middle of the
// rectangle the build reported and lifting in the same place, one driven frame
// each. That the landing alone selects is `pointer/title-touch-selects`'.
//
// THE TOLERANCE. None: a screen name and a menu index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  touchTapAt,
  type Harness,
} from "../harness";
import { menuPoints, poseTitle } from "./stage";

/** The item the contact takes: `HOW TO PLAY`, the third of `TITLE_ITEMS`. */
const TAPPED = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen when a contact lands and lifts in its item", async () => {
  await poseTitle(h);
  const points = await menuPoints(h, TITLE_ITEMS.length, "for the title menu");

  const taken = await touchTapAt(h, points[TAPPED]!);
  await captureStill(h, "taken");

  assertEqual(taken.screen, "howto", "the screen the contact took");
  assertEqual(taken.menuIndex, 0, "menuIndex on arriving at the how-to screen");
});
