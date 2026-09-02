// screens/difficulty-shows-its-figures — every difficulty row reports the two
// figures that difficulty changes, before any of them is chosen.
//
// THE RULE. specs/screens.md's `difficultyselect` section: "Each row draws that
// difficulty's starting money and its wave count, before it is chosen."
// specs/modes.md fixes the six figures — Easy `350` money over `15` waves, Medium
// `250` over `20`, Hard `200` over `26` — and states that a difficulty "changes the
// starting money and the wave count, and nothing else", which is exactly why those
// two are what a player must be able to compare before committing.
//
// ALL SIX ON ONE FRAME, WITH NOTHING CHOSEN. The rule is about the rows, not about
// the highlighted one: a screen that reveals a row's figures only once the
// highlight reaches it cannot be compared, which is the whole point of drawing
// them. So the screen is posed on the row a menu opens on and every one of the six
// figures is read off that single frame.
//
// THE FIGURES ARE READ AS WHOLE NUMBERS, NOT AS SUBSTRINGS. Every run of text the
// frame drew is broken into its runs of digits, so `350` is found as `350` and not
// inside `1350`, and a screen reporting the wrong number cannot pass on the right
// one being a piece of it. How a build dresses a figure — a currency mark, a
// label either side of it, a row of its own — is the build's, and none of it
// survives the tokenizing. specs/overview.md fixes no layout, so nothing here
// reads WHERE a figure was drawn.
//
// THE SIX FIGURES ARE ALL DIFFERENT NUMBERS, which is what makes the reading
// precise: a build that draws one difficulty's pair against all three rows, or the
// same pair three times, is missing four of the six and the failure names which.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { DIFFICULTIES, DIFFICULTY_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drawFrame,
  startMoneyOf,
  waveCountOf,
  type Harness,
} from "../harness";
import { numbersDrawn, poseMenu } from "./menu";

/** The row the screen is posed on: the first, which is where a menu opens. */
const OPENING_ROW = 0;

/** The mode whose difficulties these are: the one mode that has any. */
const MODE = "containment";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports each difficulty's starting money and wave count before it is chosen", async () => {
  poseMenu(h, "difficultyselect", OPENING_ROW);
  const calls = await drawFrame(h);
  captureStill(h, "figures");

  assertEqual(
    h.snapshot().screen,
    "difficultyselect",
    "posing: the screen the figures are read from (specs/screens.md)",
  );

  const drawn = numbersDrawn(calls);
  DIFFICULTIES.forEach((difficulty, index) => {
    const label = DIFFICULTY_ITEMS[index];
    assertContains(
      drawn,
      String(startMoneyOf(MODE, difficulty)),
      `the starting money the ${JSON.stringify(label)} row reports, among ` +
        `the whole numbers the screen drew (specs/screens.md, specs/modes.md)`,
    );
    assertContains(
      drawn,
      String(waveCountOf(MODE, difficulty)),
      `the wave count the ${JSON.stringify(label)} row reports, among the ` +
        `whole numbers the screen drew (specs/screens.md, specs/modes.md)`,
    );
  });
});
