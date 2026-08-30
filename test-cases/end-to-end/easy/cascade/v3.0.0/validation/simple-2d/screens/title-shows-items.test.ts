// screens/title-shows-items — the title screen draws both of its menu items.
//
// THE RULE. specs/screens.md fixes the title screen's Items as `TITLE_ITEMS`,
// whose content is `NEW GAME`, `HOW TO PLAY`, "in that order", and states that
// each item's label is drawn on the screen. Every piece of screen copy the file
// names "is the text that is drawn". So a frame of the title screen carries both
// literals among its text.
//
// BOTH, IN ONE DIRECTION. The two labels are one requirement — the title screen
// offers the player its menu — so both are read here, and a build missing either
// one fails naming the one it is missing. Splitting them further would grade one
// menu twice.
//
// THE SCREEN IS POSED RATHER THAN OPENED, with `setScreen("title")`, which changes
// nothing else (specs/instrumentation.md); `clearTable` empties the piles the
// specification lets show behind it. Matching is by substring, ignoring case
// ({@link drewText}), because a menu entry is commonly drawn with a marker or
// padding beside it.
//
// WHAT THIS DOES NOT DECIDE. That each label sits inside the rectangle
// specs/controls.md fixes for it, and that pressing there does anything:
// `screens/title-new-game-enters-play` and `screens/title-how-to-opens` decide
// what the two controls do.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws both TITLE_ITEMS literals among the title screen's text", async () => {
  h.debug.setScreen("title");
  h.debug.clearTable();
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: the game is on the title screen the frame below draws " +
      "(specs/instrumentation.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "title");

  for (const item of TITLE_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the title screen's frame drawing the ${item} entry of TITLE_ITEMS ` +
        "(specs/screens.md)",
    );
  }
});
