// Meltdown — screens/difficulty-lists-its-rows: the difficulty list draws every row
// of DIFFICULTY_ITEMS.
//
// THE RULE. specs/screens.md, `difficultyselect`: "Draws the four rows of
// `DIFFICULTY_ITEMS`: `EASY`, `MEDIUM`, `HARD`, and `BACK`."
//
// ONE READING PER ROW OF ONE REQUIREMENT: each name is looked for as a run of
// text, and the failure names the one the build did not draw. A build that lists
// two difficulties leaves one a player can never reach, and a build that omits
// `BACK` leaves a touchscreen player no way off the list, so every row is the
// requirement.
//
// THE NAMES COME OFF `DIFFICULTY_ITEMS`, the seeded constant, rather than being
// written out here.
//
// WHAT EACH ROW REPORTS is `screens.difficulty-shows-its-figures`, and where
// confirming one leads is `screens.difficulty-starts-the-run`; this item reads the
// list alone. Where the rows sit is the build's: specs/screens.md fixes "a
// vertical list of rows" and no more.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTY_ITEMS } from "../constants";
import { captureStill, createHarness, resetTo, type Harness } from "../harness";
import { readScreen, requireRun } from "./menu";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws Easy, Medium and Hard on the difficulty list", async () => {
  resetTo(h);
  h.debug.setScreen("difficultyselect");
  h.debug.setMenuIndex(0);

  const runs = await readScreen(h);
  captureStill(h, "difficulties");

  assertEqual(
    h.snapshot().screen,
    "difficultyselect",
    "the screen the scenario is posed on",
  );
  for (const item of DIFFICULTY_ITEMS) {
    requireRun(runs, item, "the difficulty list");
  }
});
