// screens/difficulty-lists-three — the difficulty screen names Easy, Medium and
// Hard.
//
// THE RULE. specs/screens.md's `difficultyselect` section: it "Draws the three
// rows of `DIFFICULTY_ITEMS`: `EASY`, `MEDIUM`, and `HARD`." specs/modes.md fixes
// what each of them changes; this item is only that all three are on the screen to
// be chosen from.
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

it("names all three difficulties on the difficulty screen", async () => {
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
