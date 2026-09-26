// input/back-selection — `back` clears the selection once nothing is held.
//
// THE REQUIREMENT. `specs/controls.md` gives `back` one ordered list to resolve
// against, and the selection is the SECOND of the six: "a held rock is put away;
// the selection is cleared; an open overlay is closed; on `playing` the pause menu
// opens". So with nothing on the cursor and a structure selected, `back` clears the
// selection and stops there.
//
// HOW IT IS DECIDED. A structure is selected on an otherwise empty yard with an
// overlay open behind it and nothing held, which is exactly the state that
// separates the second rung of the list from the third and fourth. `back` is
// pressed once, as a player presses it, a real key event dispatched at the
// engine's own surface, and three things are read: the selection and the combine
// set are gone, and the overlay and the screen are where they were.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  openYard,
  pressAction,
  standComponent,
} from "../harness";
import { keyFor } from "../constants";

/** Where the selected structure stands: clear of the chain. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("clears the selection and leaves the overlay and the screen alone", async () => {
  openYard(h);
  const id = standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  h.debug.select(id);
  h.debug.addToCombineSet(id);
  h.debug.setOverlay("combos", true);

  const posed = h.snapshot();
  assertEqual(
    posed.held.active,
    false,
    "nothing held on the cursor, so back's first rung does not apply " +
      "(specs/controls.md)",
  );
  assertEqual(
    posed.selected,
    id,
    "a structure selected before back is pressed (specs/instrumentation.md)",
  );

  await pressAction(h, "back");
  captureStill(h, "back");

  const after = h.snapshot();
  assertNull(
    after.selected,
    `pressing ${keyFor("back")} with nothing held and a structure selected to ` +
      "clear the selection (specs/controls.md)",
  );
  assertDeepEqual(
    after.combineSet,
    [],
    "the combine set after the selection is cleared " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    after.overlays.combos,
    true,
    "the open overlay after back cleared the selection, which it leaves alone " +
      "(specs/controls.md)",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen after back cleared the selection, which it leaves alone " +
      "(specs/controls.md)",
  );
});
