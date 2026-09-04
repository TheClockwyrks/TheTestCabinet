// screens/difficulty-lists-its-rows — the difficulty screen names every row of
// DIFFICULTY_ITEMS.
//
// THE RULE. specs/screens.md's `difficultyselect` section: it "Draws the four
// rows of `DIFFICULTY_ITEMS`: `EASY`, `MEDIUM`, `HARD`, and `BACK`."
// specs/modes.md fixes what each difficulty changes; this item is only that every
// row is on the screen — the three to choose from, and the `BACK` row that is the
// list's only way out on a touchscreen.
//
// THE COPY IS THE CASE'S. `DIFFICULTY_ITEMS` lives in `constants.ts`,
// transcribed from specs/screens.md. Matching is by substring and ignores case,
// because a row is commonly drawn with a marker or padding around it, and
// specs/overview.md fixes no typeface, no palette and no layout.
//
// ONE FRAME, ON THE SCREEN ITSELF. `setScreen` runs no entry effect
// (specs/instrumentation.md), so what is read is what the build draws for
// `difficultyselect`. What each row REPORTS is `screens.difficulty-shows-its-figures`'s
// requirement and where confirming one leads is `screens.difficulty-starts-the-run`'s;
// nothing is confirmed here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTY_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  drewText,
  type Harness,
} from "../harness";
import { poseMenu } from "./menu";

/** The row the screen is posed on: the first, which is where a menu opens. */
const OPENING_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("names every row of the difficulty screen", async () => {
  poseMenu(h, "difficultyselect", OPENING_ROW);
  const calls = await drawFrame(h);
  captureStill(h, "difficulties");

  assertEqual(
    h.snapshot().screen,
    "difficultyselect",
    "posing: the screen the list is read from (specs/screens.md)",
  );
  for (const item of DIFFICULTY_ITEMS) {
    assertEqual(
      drewText(calls, item),
      true,
      `the ${JSON.stringify(item)} row of DIFFICULTY_ITEMS drawn on the ` +
        `difficulty screen (specs/screens.md)`,
    );
  }
});
