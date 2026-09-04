// Meltdown — screens/difficulty-starts-the-run: choosing a difficulty starts
// Containment on it.
//
// THE RULE. `specs/screens.md`, on `difficultyselect`: "Confirming a row opens
// `playing` in the `opening` phase, on Containment at that difficulty."
//
// WHY THIS ITEM IS CAPPED `broken` AND NAMES EVERY FUNCTIONAL DOMAIN. It is the
// last of the three doors between the title screen and a Containment run. A build
// that cannot pass it cannot be played on the standard mode at all, so its heat
// model, its defence, its run and its presentation are all unreachable, and since
// a run's functional rating is the worst across the domains in play, an item
// naming presentation alone would leave such a build carrying a flawless heat,
// defence and run rating.
//
// MEDIUM, THE MIDDLE ROW, AND WHY IT IS THE DISTINGUISHING ONE. Row `1` of
// `DIFFICULTY_ITEMS` is the only row a build can reach neither by taking the first
// row nor by taking the last, so a build that ignores the highlight and opens Easy
// reads `easy` here and a build that always opens Hard reads `hard`. `reset` puts
// `difficulty` at `"medium"` (`specs/instrumentation.md`), which would let a build
// that carried the field through untouched coincide with the reading — so the
// difficulty is posed to Hard BEFORE the row is taken, and Medium can then only
// come from the row that was confirmed.
//
// WHAT THIS ITEM DOES NOT DECIDE. The figures the run opens on — the phase, the
// wave, the money and the lives — are `modes.run-opens-with-its-figures`'s
// reading, and Hard's and Medium's own derived figures are `modes.containment-*`'s.
// This one is about the door: the screen it opens, on which mode, at which
// difficulty.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTIES, DIFFICULTY_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `MEDIUM`, the middle of the three `DIFFICULTY_ITEMS`. */
const MEDIUM_ROW = DIFFICULTIES.indexOf("medium");

/**
 * What the difficulty is posed to before the row is taken.
 *
 * Anything but the row being confirmed, so that reading `medium` afterwards can
 * only have come from the confirm. `reset` leaves the field at `"medium"`, which
 * is precisely why it is moved.
 */
const POSED_DIFFICULTY = "hard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens Containment at Medium when the middle difficulty row is confirmed", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setDifficulty(POSED_DIFFICULTY);
  await debug.setScreen("difficultyselect");
  await debug.setMenuIndex(MEDIUM_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "difficultyselect",
    "the screen the scenario is posed on",
  );
  assertEqual(posed.menuIndex, MEDIUM_ROW, "the row the scenario is posed on");
  assertEqual(
    posed.difficulty,
    POSED_DIFFICULTY,
    "the difficulty the scenario is posed on, so that reading medium can only come from the confirm",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "started");

  const after = await h.snapshot();
  const where = `${DIFFICULTY_ITEMS[MEDIUM_ROW]}, row ${MEDIUM_ROW} of ${DIFFICULTY_ITEMS.length} on the difficulty list`;
  assertEqual(
    after.screen,
    "playing",
    `the screen confirming ${where} leads to`,
  );
  assertEqual(after.mode, "containment", `the mode confirming ${where} starts`);
  assertEqual(
    after.difficulty,
    "medium",
    `the difficulty confirming ${where} starts`,
  );
});
