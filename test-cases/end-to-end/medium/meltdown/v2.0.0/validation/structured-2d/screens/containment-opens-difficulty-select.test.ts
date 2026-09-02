// Meltdown — screens/containment-opens-difficulty-select: Containment asks for a
// difficulty before it starts.
//
// THE RULE. specs/screens.md, `modeselect`: of the five rows, `CONTAINMENT` leads
// to `difficultyselect` and "Any other row" leads to `playing`. specs/modes.md
// says why: Containment "is the only mode with a difficulty".
//
// CONTAINMENT IS THE EXCEPTION, AND IT IS ITS OWN ITEM. The other four rows open a
// run at once, which is `screens.special-mode-starts-immediately`'s requirement.
// A build that starts Containment straight from the list — skipping the choice
// entirely and fixing the difficulty at whatever it happened to be — fails here
// and passes there, which is exactly the grade that build has earned.
//
// SO THE READING IS TWO-SIDED: the screen must be `difficultyselect`, and it must
// NOT be `playing`. Both come off the one snapshot after the press.
//
// WHY THE CAP IS `broken` AND EVERY DOMAIN IS NAMED. Containment is the standard
// mode, and this row is the route to it; a build that cannot pass through it has
// no reachable heat model, defence or run on the mode the whole case is written
// around.
//
// THE ROW IS POSED, NOT WALKED, so a build whose arrow keys are broken still gets
// a fair reading of where its Containment row leads. WHICH DIFFICULTY the next
// screen then starts is `screens.difficulty-starts-the-run`'s requirement.
//
// THE ROW INDEX COMES OFF `MODE_ITEMS` rather than being written as `0`, so this
// confirms the row the case's own copy calls Containment.

import { afterEach, beforeEach, it } from "vitest";
import { MODE_ITEMS } from "../constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `CONTAINMENT`, the first of the five `MODE_ITEMS`. */
const CONTAINMENT_ROW = MODE_ITEMS.indexOf("CONTAINMENT");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens difficulty select, and starts no run, when Containment is confirmed", async () => {
  resetTo(h);
  h.debug.setScreen("modeselect");
  h.debug.setMenuIndex(CONTAINMENT_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.screen,
    "modeselect",
    "the screen the scenario is posed on",
  );
  assertEqual(
    before.menuIndex,
    CONTAINMENT_ROW,
    "the row the scenario is posed on",
  );

  await tapAction(h, "confirm");
  captureStill(h, "difficulty");

  const after = h.snapshot();
  assertNotEqual(
    after.screen,
    "playing",
    "Containment asks for a difficulty rather than starting a run " +
      "(specs/screens.md, `modeselect`)",
  );
  assertEqual(
    after.screen,
    "difficultyselect",
    `the screen confirming row ${CONTAINMENT_ROW} of the mode list leads to`,
  );
});
