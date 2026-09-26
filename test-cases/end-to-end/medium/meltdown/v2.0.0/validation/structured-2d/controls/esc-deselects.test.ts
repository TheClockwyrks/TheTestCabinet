// Meltdown — controls/esc-deselects: Escape with a tower selected deselects it,
// and does not pause.
//
// THE RULE. specs/controls.md resolves `back` — bound to `Escape` — "in this
// order, taking the first case that applies: ... 2. A tower is selected: deselect
// it, leaving the screen where it is. 3. The screen is `playing`: open the pause
// screen." This item is case 2, and as with case 1 the requirement has two halves
// that are one rule: the selection clears, AND case 3 is not also taken.
// specs/building.md says what deselecting leaves behind — "Deselecting leaves no
// tower selected" — reported as `selected` going null.
//
// BOTH HALVES, BECAUSE EITHER ALONE LETS A WRONG BUILD THROUGH. A build that
// deselects and pauses has taken two cases where the specification allows one; a
// build that pauses with a tower still selected has taken the wrong case.
//
// NOTHING IS ARMED, AND THAT IS WHAT MAKES THIS CASE 2. Case 1 sits above it, so
// with a placement armed Escape is required to cancel and not to deselect;
// `controls.esc-cancels-a-held-placement` reads that. `startRun` leaves `build`
// null and it is read back below.
//
// THE TOWER IS POSED AND SELECTED, NOT PLACED AND NOT TAPPED. `addTower` puts one
// Arc on the floor at no cost and runs no placement check, and `setSelected` opens
// its inspector (specs/instrumentation.md); neither is the act this item is about,
// so a build whose placement or pointer selection is broken fails
// `building.place-builds-the-tower` and `controls.pointer-selects-a-tower` rather
// than this. The anchor is a quiet one, so nothing about the floor's routes enters
// a reading about a key.
//
// THE WORLD IS OTHERWISE AN EMPTY, QUIET, LIVE RUN, so nothing can clear the
// selection on its own: specs/building.md clears it only when the selected tower
// is sold, and nothing here sells.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { QUIET_SITE } from "./scene";

/** The key specs/controls.md binds `back` to, as a `KeyboardEvent.code`. */
const KEY = "Escape";

/** The tower posed and selected: the cheapest emitter in the shop. */
const TYPE = "arc";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the selection and leaves the game playing when Escape is pressed with a tower selected", async () => {
  startRun(h);
  const id = poseTower(h, TYPE, QUIET_SITE.col, QUIET_SITE.row);
  h.debug.setSelected(id);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.selected, id, "the selection the scenario is posed with");
  assertNull(before.build, "the held preview the scenario is posed with");

  await h.tap(KEY);
  captureStill(h, "deselected");

  const after = h.snapshot();
  assertNull(
    after.selected,
    `${KEY}: the selection after one press with a tower selected and nothing armed`,
  );
  assertEqual(
    after.screen,
    "playing",
    `${KEY}: the screen after one press with a tower selected, which deselecting leaves where it is`,
  );
});
