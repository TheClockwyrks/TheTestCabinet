// Meltdown — screens/difficulty-lists-three: the difficulty list names Easy,
// Medium and Hard.
//
// THE RULE. `specs/screens.md`, on `difficultyselect`: it "Draws the three rows of
// `DIFFICULTY_ITEMS`: `EASY`, `MEDIUM`, and `HARD`." All three, because
// `specs/modes.md` gives each its own starting money and wave count and a
// difficulty a player cannot see is one a player cannot choose.
//
// EACH NAME IS ASSERTED SEPARATELY, so a build that drew two of the three fails
// with the missing one named. MATCHED BY SUBSTRING, because the words are the
// case's and the presentation is the build's: a row is commonly drawn with a marker
// or padding beside it.
//
// THE SCREEN IS POSED, because what the list DRAWS does not depend on how a player
// got to it — reaching it is `screens.containment-opens-difficulty-select`'s
// reading. What each row SHOWS about the run it starts is
// `screens.difficulty-shows-its-figures`'s, and where a row leads is
// `screens.difficulty-starts-the-run`'s.
//
// THE HIGHLIGHT IS LEFT WHERE `reset` PUTS IT, on row `0`, because every row must be
// drawn whichever one is highlighted.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTY_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws all three difficulty names on the difficulty list", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setScreen("difficultyselect");

  const calls = await h.frameCalls();
  await captureStill(h, "difficulties");

  assertEqual(
    (await h.snapshot()).screen,
    "difficultyselect",
    "the screen the list is read on",
  );
  for (const [row, item] of DIFFICULTY_ITEMS.entries()) {
    assertEqual(
      drewText(calls, item),
      true,
      `the difficulty list drew ${item}, row ${row} of ${DIFFICULTY_ITEMS.length}`,
    );
  }
});
