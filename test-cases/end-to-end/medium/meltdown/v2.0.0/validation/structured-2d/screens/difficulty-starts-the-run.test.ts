// Meltdown — screens/difficulty-starts-the-run: confirming a difficulty opens a
// Containment run at that difficulty.
//
// THE RULE. specs/screens.md, `difficultyselect`: "Confirming a row opens
// `playing` in the `opening` phase, on Containment at that difficulty."
//
// THE DIFFICULTY POSED IS NOT THE DIFFICULTY CONFIRMED, and that is the whole
// design of this check. The run is posed carrying `hard` — a state a player
// reaches by playing a Hard run and coming back to the list, since
// specs/instrumentation.md's `setDifficulty` "changes no other field" and the
// difficulty is not reset by opening the list — and then the `MEDIUM` row is
// confirmed. A build that opens a run without reading the row lands on `hard`; a
// build that reads it lands on `medium`. One reading tells the two apart, which a
// scenario posed on the row it was already on could not.
//
// THE MODE IS LEFT WHERE A PLAYER WOULD LEAVE IT. `difficultyselect` is reached
// from the Containment row alone, so `containment` is the only mode a player can
// be on when this screen is open, and posing any other would be posing a state
// the game cannot be in — and would fail a build that sets the mode on the way IN
// to this screen rather than on the way out, which specs/screens.md permits. So
// the mode is read back as `containment` rather than posed against.
//
// FOUR READINGS, EACH ITS OWN WRONG BUILD: the SCREEN is `playing` (a build that
// stops on the list started nothing), the PHASE is `opening` (specs/modes.md: "A
// run that has just started is in the `opening` phase"), the MODE is
// `containment`, and the DIFFICULTY is the row's.
//
// WHY THE CAP IS `broken` AND EVERY DOMAIN IS NAMED. This row is the last step of
// the only route into a Containment run; a build that cannot pass it has no
// reachable heat model, defence or run on the mode the case is written around.
//
// THE ROW INDEX COMES OFF `DIFFICULTY_ITEMS` and the difficulty off
// `DIFFICULTIES`, in the order specs/modes.md's table names them, so neither the
// label nor the slug is written out here.

import { afterEach, beforeEach, it } from "vitest";
import { DIFFICULTIES, DIFFICULTY_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `MEDIUM`, the second of the three `DIFFICULTY_ITEMS`. */
const CHOSEN_ROW = DIFFICULTY_ITEMS.indexOf("MEDIUM");

/** The difficulty that row names (specs/modes.md's table order). */
const CHOSEN = DIFFICULTIES[CHOSEN_ROW];

/**
 * The difficulty the list is posed carrying: the one row that is NOT confirmed
 * and is not the one a reset leaves behind either, so the reading after the
 * press can only have come from the row.
 */
const POSED = DIFFICULTIES[DIFFICULTY_ITEMS.indexOf("HARD")];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a Containment run in the opening phase at the difficulty the confirmed row names", async () => {
  resetTo(h);
  h.debug.setScreen("difficultyselect");
  h.debug.setDifficulty(POSED);
  h.debug.setMenuIndex(CHOSEN_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "difficultyselect",
    "the screen the scenario is posed on",
  );
  assertEqual(
    before.difficulty,
    POSED,
    "the difficulty the list is posed with",
  );
  assertEqual(before.menuIndex, CHOSEN_ROW, "the row the scenario is posed on");

  await tapAction(h, "confirm");
  captureStill(h, "started");

  const after = h.snapshot();
  assertEqual(
    after.screen,
    "playing",
    `the screen confirming row ${CHOSEN_ROW} of the difficulty list leads to`,
  );
  assertEqual(
    after.phase,
    "opening",
    "the phase a run just started is in (specs/modes.md)",
  );
  assertEqual(after.mode, "containment", "the mode the difficulty list starts");
  assertEqual(
    after.difficulty,
    CHOSEN,
    `the difficulty confirming the ${DIFFICULTY_ITEMS[CHOSEN_ROW]} row starts ` +
      `the run at, from a list posed on ${POSED}`,
  );
});
