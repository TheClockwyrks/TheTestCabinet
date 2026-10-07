// input/back-overlay — `back` closes an open overlay once nothing is held or
// selected.
//
// THE REQUIREMENT. `specs/controls.md` gives `back` one ordered list to resolve
// against, and an open overlay is the THIRD of the six: "a held rock is put away;
// the selection is cleared; an open overlay is closed; on `playing` the pause menu
// opens". So with nothing on the cursor and nothing selected, `back` closes the
// overlay and does not open the pause menu.
//
// HOW IT IS DECIDED. The recipe book is opened on a run with an empty cursor, an
// empty selection and an otherwise empty yard, which is exactly the state that
// separates the third rung of the list from the fourth. `back` is pressed once, as
// a player presses it, a real browser key event through the build's own keyboard
// layer, and two things are read: the overlay is closed, and the screen still
// reads `playing` rather than having stepped past the overlay into the pause menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("closes the open overlay and leaves the run on playing", async () => {
  await openYard(h);
  await h.debug.clearSelection();
  await h.debug.setOverlay("combos", true);

  const posed = await h.snapshot();
  assertEqual(
    posed.held.active,
    false,
    "nothing held on the cursor, so back's first rung does not apply " +
      "(specs/controls.md)",
  );
  assertNull(
    posed.selected,
    "nothing selected, so back's second rung does not apply " +
      "(specs/controls.md)",
  );
  assertEqual(
    posed.overlays.combos,
    true,
    "the recipe book open before back is pressed (specs/instrumentation.md)",
  );

  await h.tap(keyFor("back"));
  await captureStill(h, "back");

  const after = await h.snapshot();
  assertEqual(
    after.overlays.combos,
    false,
    `pressing ${keyFor("back")} with nothing held and nothing selected to ` +
      "close the open overlay (specs/controls.md)",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen after back closed an overlay, which stops there rather than " +
      "opening the pause menu as well (specs/controls.md)",
  );
});
