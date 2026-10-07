// Meltdown — screens/difficulty-back-row — confirming BACK on the difficulty list returns
// to the mode list, and starts no run.
//
// THE RULE. `specs/screens.md`, on `difficultyselect`: the screen "draws the four
// rows of `DIFFICULTY_ITEMS`: `EASY`, `MEDIUM`, `HARD`, and `BACK`", and the row
// table sends `BACK` to `modeselect` while "any other row" starts a run.
//
// SO THE READING IS TWO-SIDED IN ONE DIRECTION: the screen afterwards is
// `modeselect`, which is also NOT `playing`. A build that wired the fourth row as
// a fourth difficulty opens a run instead, and reads `playing` here.
//
// WHY THE ROW EXISTS AND WHY IT IS GRADED. `specs/controls.md` makes every
// interaction reachable with the pointer alone and the game fully playable on a
// touchscreen, so a screen a player can only leave with a key strands a player who
// has no keyboard. That `back` reaches the same screen is
// `screens.back-from-difficulty-select`'s requirement, and the two are separately
// breakable.
//
// THE ROW IS TAKEN, NOT POSED. Where a row leads is an entry effect, and
// `setScreen` runs none (`specs/instrumentation.md`), so the highlight is put on
// the row and `confirm` is pressed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { DIFFICULTY_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `BACK`, the last of the `DIFFICULTY_ITEMS`. */
const BACK_ROW = DIFFICULTY_ITEMS.indexOf("BACK");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to the mode list when BACK is confirmed", async () => {
  await h.debug.reset();
  await h.debug.setScreen("difficultyselect");
  await h.debug.setMenuIndex(BACK_ROW);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.screen,
    "difficultyselect",
    "the screen the row is confirmed on",
  );
  assertEqual(before.menuIndex, BACK_ROW, "the row the confirm is made on");

  await tapAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "modeselect");

  const after = await h.snapshot();
  assertNotEqual(
    after.screen,
    "playing",
    "BACK names no difficulty, so confirming it starts no run",
  );
  assertEqual(
    after.screen,
    "modeselect",
    "the screen confirming the difficulty list's BACK row leads to",
  );
});
