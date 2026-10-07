// input/pointer-activates-menu — a press at a reported menu rectangle takes that
// choice.
//
// THE REQUIREMENT. `specs/controls.md` makes the pointer the complete path:
// "Every screen and every control is fully operable with the pointer alone", and
// "A press at the center of a control's drawn rectangle activates it."
// `specs/instrumentation.md` states the same rule from the reading's side: "The
// rectangle a reading reports is the control's real hit region: a press and
// release at the center of a reported, non-disabled rectangle activates that
// control." Because `specs/ui.md` fixes each menu's content and navigation rather
// than its layout, that agreement is the only way a caller — or a reviewer's
// automation — finds a choice without knowing where it was drawn.
//
// HOW IT IS DECIDED. The map select's Switchyard choice is taken from
// `menuButtons` and pressed at the centre of the rectangle the BUILD reported for
// it, and what that choice commits is read back: the difficulty select, on the
// Switchyard. Nothing here assumes a coordinate, so a build that draws its menu
// somewhere else and reports it honestly passes, and one whose reported
// rectangles are decorative fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  menuControl,
  openMenu,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("activates a menu choice pressed at its reported rectangle", async () => {
  await h.debug.reset();
  await openMenu(h, "mapselect");

  const choice = await menuControl(h, "map-switchyard");
  assertEqual(
    choice.disabled,
    false,
    "the Switchyard choice to be offered rather than disabled (specs/ui.md)",
  );
  await clickControl(h, choice);
  await captureStill(h, "press");

  const landed = await h.snapshot();
  assertEqual(
    landed.screen,
    "difficultyselect",
    "pressing the centre of the reported `map-switchyard` rectangle to take " +
      "that choice (specs/instrumentation.md)",
  );
  assertEqual(
    landed.map,
    "switchyard",
    "the map that choice fixes for the run (specs/ui.md)",
  );
});
