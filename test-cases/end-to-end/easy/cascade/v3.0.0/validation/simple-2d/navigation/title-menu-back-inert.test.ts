// navigation/title-menu-back-inert — `menu-back` does nothing on the title.
//
// THE RULE. `specs/controls.md`, Menu navigation, the per-screen table: `title` /
// `menu-back` — "Nothing."
//
// WHY AN INERT ACTION IS GRADED AT ALL. The title is where the game opens, and it
// is the screen a player reaches by leaving one. A build that treats `Escape` as a
// universal "go back" has somewhere to go from here and will take it — to a screen
// the specification does not name, or to a fresh deal — and a player who pressed a
// key expecting nothing gets something uninvited. That affects play without taking
// a route away, which is what its `passable` cap says.
//
// THE CAP IS WHY THIS IS NOT `scuffed`. A build acting on an action the
// specification makes inert has not lost the player a route; the routes that DO
// exist are graded by `navigation/title-menu-confirm` and the pointer points.
//
// BOTH FIELDS ARE READ. A build that moved the selection and stayed on the screen
// is as wrong as one that left the screen, and the two fail differently, so the
// press is required to leave `screen` and `menuIndex` exactly where it found
// them. The selection is posed to the SECOND item so that a build which resets
// the menu on an unhandled key reads as `0` rather than agreeing by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MENU_BACK_KEY, TITLE_HOW_TO_ITEM } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  pressKey,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the title screen and its selection where they were", async () => {
  openTitle(h);
  h.debug.setMenuIndex(TITLE_HOW_TO_ITEM);
  assertEqual(
    h.snapshot().menuIndex,
    TITLE_HOW_TO_ITEM,
    "posing: menuIndex before the press — a selection that was never posed " +
      "could not say whether the press moved it",
  );

  await pressKey(h, MENU_BACK_KEY);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a press that did something still leaves the
  // picture of what it left.
  captureStill(h, "title");

  assertEqual(
    after.screen,
    "title",
    `the screen one press of ${MENU_BACK_KEY} left the game on, which on the ` +
      `title does nothing (specs/controls.md)`,
  );
  assertEqual(
    after.menuIndex,
    TITLE_HOW_TO_ITEM,
    `menuIndex after that press, against the ${TITLE_HOW_TO_ITEM} it was ` +
      `posed to — menu-back does nothing on the title (specs/controls.md)`,
  );
});
