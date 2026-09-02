// screens/difficulty-starts-the-run — confirming a difficulty opens a Containment
// run at that difficulty.
//
// THE RULE. specs/screens.md's `difficultyselect` section: "Confirming a row opens
// `playing` in the `opening` phase, on Containment at that difficulty."
//
// THE DISTINGUISHING POSE: THE SCREEN IS OPENED WITH A DIFFERENT DIFFICULTY IN
// HAND. The run holds a difficulty of its own before the choice is made — `reset`
// leaves `medium` there — and a build that opens the screen and then starts
// whatever it was already holding would pass a check made on the row it was already
// on. So the difficulty is posed to `hard` and `MEDIUM` is the row confirmed: a
// build that takes the row reads `medium`, a build that ignores it reads `hard`,
// and the two are different answers rather than the same one.
//
// THE MODE IS POSED HONESTLY. specs/screens.md reaches this screen from the
// Containment row of the mode list and from nowhere else, so `containment` is the
// mode the screen is posed with — the precondition a player would arrive under —
// and what is READ is that the run opened on Containment rather than on some other
// mode of the build's choosing.
//
// THREE READINGS. The screen says a run opened; the phase says it opened where a
// run opens, in the untimed `opening` phase specs/waves.md puts before Wave 1; and
// the difficulty says it opened at the one the row named. What that difficulty
// then sets — the starting money and the wave count of specs/modes.md — is the
// `modes` group's business, not this item's.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, DIFFICULTIES, DIFFICULTY_ITEMS } from "../constants";
import { assertEqual, assertNotEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row confirmed: `MEDIUM`, the second of the three. */
const CHOSEN_ROW = 1;

/**
 * The difficulty the screen is opened holding — deliberately not the one chosen.
 *
 * A build that starts the difficulty it was already on rather than the row it was
 * given reads this back, which is a different answer from the one the row names.
 */
const HELD_BEFORE = "hard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts Containment at the difficulty whose row is confirmed", async () => {
  assertNotEqual(
    DIFFICULTIES[CHOSEN_ROW],
    HELD_BEFORE,
    "posing: the row confirmed names a difficulty other than the one held " +
      "(specs/modes.md, DIFFICULTIES)",
  );
  poseMenu(h, "difficultyselect", CHOSEN_ROW);
  h.debug.setMode("containment");
  h.debug.setDifficulty(HELD_BEFORE);
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "difficultyselect",
    "posing: the screen the press is made on (specs/screens.md)",
  );

  await h.tap(CONFIRM);
  captureStill(h, "started");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "playing",
    `${CONFIRM} on the ${DIFFICULTY_ITEMS[CHOSEN_ROW]} row: the screen it ` +
      `leads to (specs/screens.md)`,
  );
  assertEqual(
    after.phase,
    "opening",
    `${CONFIRM} on the ${DIFFICULTY_ITEMS[CHOSEN_ROW]} row: the phase a run ` +
      `opens in (specs/screens.md, specs/waves.md)`,
  );
  assertEqual(
    after.mode,
    "containment",
    `${CONFIRM} on the ${DIFFICULTY_ITEMS[CHOSEN_ROW]} row: the mode the ` +
      `difficulty screen starts (specs/screens.md)`,
  );
  assertEqual(
    after.difficulty,
    DIFFICULTIES[CHOSEN_ROW],
    `${CONFIRM} on the ${DIFFICULTY_ITEMS[CHOSEN_ROW]} row: the difficulty ` +
      `the run opened at, with ${JSON.stringify(HELD_BEFORE)} held before ` +
      `the press (specs/screens.md)`,
  );
});
