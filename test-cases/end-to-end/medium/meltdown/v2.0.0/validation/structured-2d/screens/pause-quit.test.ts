// Meltdown — screens/pause-quit: QUIT TO MENU leaves the run for the title.
//
// THE RULE. specs/screens.md, `paused`: the `QUIT TO MENU` row leads to `title`.
//
// THE DESTINATION IS THE POINT, and it is read against the two wrong answers this
// row is confused with: a build that treats every pause row as "close the menu"
// reads `playing`, and one that wires the rows in the wrong order reads whatever
// the row above it does. So the screen must be `title` and must not be `playing`.
//
// IT IS THE THIRD ROW, AND IT IS ITS OWN ITEM. `screens.pause-resume` reads the
// first and `screens.pause-restart` the second; a build that wired two of the
// three must grade differently from one that wired all three.
//
// THE ROW INDEX COMES OFF `PAUSE_ITEMS` rather than being written as `2`, so this
// confirms the row the case's own copy puts last.
//
// THE PAUSE SCREEN IS POSED OUTRIGHT over a live run — how it is reached is
// `controls.pause-key`'s requirement — and the row is posed rather than walked, so
// a build whose arrow keys are broken still gets a fair reading of what its QUIT
// row does.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `QUIT TO MENU`, the last of the three `PAUSE_ITEMS`. */
const QUIT_ROW = PAUSE_ITEMS.indexOf("QUIT TO MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when QUIT TO MENU is confirmed on the pause screen", async () => {
  startRun(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(QUIT_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen the scenario is posed on");
  assertEqual(before.menuIndex, QUIT_ROW, "the row the scenario is posed on");

  await tapAction(h, "confirm");
  captureStill(h, "title");

  const after = h.snapshot();
  assertNotEqual(
    after.screen,
    "playing",
    "QUIT TO MENU leaves the run rather than closing the menu",
  );
  assertEqual(
    after.screen,
    "title",
    `the screen confirming row ${QUIT_ROW} of the pause menu leads to`,
  );
});
