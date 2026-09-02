// Meltdown — screens/title-to-howto: confirming HOW TO PLAY opens the how-to
// screen.
//
// THE RULE. specs/screens.md, `title`: the second of the two rows of
// `TITLE_ITEMS`, `HOW TO PLAY`, leads to `howto`.
//
// THIS IS THE OTHER ROW, AND IT IS ITS OWN ITEM. A build that wired its first
// menu row and not its second is a real and ordinary defect, and it must grade
// differently from a build with both rows working and from one with neither. So
// nothing here reads the first row: `screens.title-to-mode-select` owns it.
//
// THE ROW IS POSED, NOT WALKED, so a build whose arrow keys are broken still
// gets a fair reading of where its second row leads — those keys are
// `controls.menu-down` and `controls.menu-up`. What the how-to screen then
// COVERS is `screens.howto-content`'s requirement; this item reads only that the
// row reaches it.
//
// THE INDEX COMES OFF `TITLE_ITEMS` rather than being written as `1`, so the row
// this check confirms is the row the case's own copy puts second.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `HOW TO PLAY`, the second of the two `TITLE_ITEMS`. */
const HOWTO_ROW = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to screen when HOW TO PLAY is confirmed", async () => {
  resetTo(h);
  h.debug.setScreen("title");
  h.debug.setMenuIndex(HOWTO_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the scenario is posed on");
  assertEqual(before.menuIndex, HOWTO_ROW, "the row the scenario is posed on");

  await tapAction(h, "confirm");
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    `the screen confirming row ${HOWTO_ROW} of the title menu leads to`,
  );
});
