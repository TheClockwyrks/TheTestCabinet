// input/back-opens-pause — `back` opens the pause menu on `playing`.
//
// THE REQUIREMENT. `specs/controls.md` gives `back` one ordered list to resolve
// against, and the pause menu is the FOURTH of the six: "a held rock is put away;
// the selection is cleared; an open overlay is closed; on `playing` the pause menu
// opens". So with the cursor empty, nothing selected and both overlays closed,
// `back` on `playing` is what a player uses to reach the pause menu.
// `specs/ui.md` names the screen it reaches: `paused`, "the pause menu, over a yard
// that is visible and frozen behind it".
//
// HOW IT IS DECIDED. The three rungs above this one are all cleared explicitly on
// an otherwise empty yard — nothing held, nothing selected, both overlays closed —
// and then `back` is pressed once as a player presses it, a real key event
// dispatched at the engine's own surface. The screen is read back.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  openYard,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens the pause menu when nothing above it in back's list applies", async () => {
  openYard(h);
  h.debug.clearSelection();
  h.debug.setOverlay("combos", false);
  h.debug.setOverlay("damage", false);

  const posed = h.snapshot();
  assertEqual(
    posed.screen,
    "playing",
    "a run on the playing screen before back is pressed (specs/ui.md)",
  );
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
    posed.overlays.combos || posed.overlays.damage,
    false,
    "no overlay open, so back's third rung does not apply (specs/controls.md)",
  );

  await pressAction(h, "back");
  captureStill(h, "back");

  assertEqual(
    h.snapshot().screen,
    "paused",
    `pressing ${keyFor("back")} on playing with nothing held, nothing ` +
      "selected and no overlay open to open the pause menu " +
      "(specs/controls.md, specs/ui.md)",
  );
});
