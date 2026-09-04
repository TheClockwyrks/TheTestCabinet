// Meltdown — controls/esc-deselects: Escape with a tower selected deselects it,
// and does not pause.
//
// specs/controls.md resolves `back` "in this order, taking the first case that
// applies: ... 2. A tower is selected: deselect it, leaving the screen where it
// is. 3. The screen is `playing`: open the pause screen." This point is case 2,
// and as with case 1 the requirement has two halves that are one rule: the
// selection clears, AND case 3 is not also taken. specs/building.md says what
// deselecting leaves behind: "Deselecting leaves no tower selected", reported as
// `selected` going `null`.
//
// BOTH HALVES, BECAUSE EITHER ALONE LETS A WRONG BUILD THROUGH. A build that
// deselects and pauses has taken two cases where the specification allows one; a
// build that pauses with a tower still selected has taken the wrong case. The pair
// separates both from a build that took case 2 and stopped.
//
// NOTHING IS ARMED, and that is what makes this case 2 rather than case 1. Case 1
// sits above it, so with a placement armed `Escape` is required to cancel and not
// to deselect; `controls.esc-cancels-a-held-placement` reads that. `startRun`
// leaves `build` `null` and this scenario leaves it there, and it is read back
// below.
//
// THE TOWER IS POSED, NOT PLACED AND NOT TAPPED. `addTower` puts one Arc on the
// floor at no cost and runs no placement check (specs/instrumentation.md), and
// `setSelected` opens its inspector; neither is the act this point is about, so
// neither can fail it for the wrong reason. A build whose placement or whose
// pointer selection is broken fails `building.place-builds-the-tower` and
// `controls.pointer-selects-a-tower`, not this.
//
// THE ANCHOR IS A QUIET ONE, clear of all four openings and of both straight
// vent-to-exhaust corridors, so the tower posed here lengthens no route and
// nothing about the floor's geometry enters a reading about a key.
//
// THE WORLD IS OTHERWISE AN EMPTY, QUIET, LIVE RUN, so nothing can clear the
// selection on its own — specs/building.md clears it only when the selected tower
// is sold, and nothing here sells.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { FREE_SITE } from "../fixtures";

/** The key specs/controls.md binds `back` to, and the only one. */
const KEY = BINDINGS.back;

/** The tower posed and selected: the cheapest emitter in the shop. */
const TYPE = "arc";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("clears the selection and leaves the game playing when Escape is pressed with a tower selected", async () => {
  await startRun(h);
  const id = await poseTower(h, TYPE, FREE_SITE.col, FREE_SITE.row);
  await h.debug.setSelected(id);
  await h.advance(1);
  const before = await h.snapshot();
  assertEqual(before.selected, id, "the selection the scenario is posed with");
  assertNull(before.build, "the held preview the scenario is posed with");

  await h.tap(KEY);
  await h.advance(1);
  const after = await h.snapshot();
  await captureStill(h, "deselected");

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
