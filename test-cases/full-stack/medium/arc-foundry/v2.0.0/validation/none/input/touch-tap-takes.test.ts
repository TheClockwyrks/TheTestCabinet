// input/touch-tap-takes — a tap inside one entry takes that entry.
//
// THE REQUIREMENT. `specs/controls.md`'s touch table: "A contact lands and lifts
// inside one menu entry's reported hit region | Moves the menu highlight to that
// entry and takes it." `specs/ui.md` repeats it and `specs/controls.md` makes it
// the whole path: "every menu is fully operable with a touch contact alone." A
// build that reaches its menus only from a mouse or a keyboard cannot be played on
// a touch screen at all.
//
// HOW IT IS DECIDED. The map select is opened directly, so a build with a broken
// title menu still has this point decided on its own terms. The Switchyard choice
// is found by the action it carries rather than by where it was drawn, and a
// contact lands and lifts at the centre of the rectangle the BUILD reported for it.
// What that choice commits is read back: the difficulty select, on the Switchyard.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  menuControl,
  openMenu,
  tapControl,
} from "../harness";

/** The choice the tap takes. */
const ENTRY = "map-switchyard";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the entry a contact landed and lifted inside", async () => {
  await h.debug.reset();
  await openMenu(h, "mapselect");

  const choice = await menuControl(h, ENTRY);
  assertEqual(
    choice.disabled,
    false,
    "the Switchyard choice to be offered rather than disabled (specs/ui.md)",
  );
  await tapControl(h, choice);
  await captureStill(h, "tap");

  const landed = await h.snapshot();
  assertEqual(
    landed.screen,
    "difficultyselect",
    `landing and lifting a contact inside the reported \`${ENTRY}\` rectangle ` +
      "to take that choice (specs/controls.md, specs/ui.md)",
  );
  assertEqual(
    landed.map,
    "switchyard",
    "the map that choice fixes for the run (specs/ui.md)",
  );
});
