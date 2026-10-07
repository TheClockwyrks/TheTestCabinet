// input/pointer-activates-menu — a press at a reported menu rectangle takes that
// choice.
//
// THE REQUIREMENT. `specs/controls.md` makes the pointer the complete path: "Every
// screen and every control is fully operable with the pointer alone", and "A press
// at the center of a control's drawn rectangle activates it."
// `specs/instrumentation.md` states the same rule from the reading's side: "The
// rectangle a reading reports is the control's real hit region: a press and
// release at the center of a reported, non-disabled rectangle activates that
// control." Because `specs/ui.md` fixes each menu's content and navigation rather
// than its layout, that agreement is the only way a caller — or a reviewer's
// automation — finds a choice without knowing where it was drawn.
//
// ONE READING PER CHECK. The four readings report four separate surfaces, and a
// build whose menu presses land and whose status-bar presses do not has missed one
// requirement rather than all four, so each reading is decided on its own. This
// one is about `menuButtons`, the choices of the menu screen showing.
//
// Nothing here assumes a coordinate. The press lands where the build said its own
// control is, so a build that draws its controls somewhere else and reports them
// honestly still passes, and one whose reported rectangles are decorative fails.

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

afterEach(() => {
  h.dispose();
});

it("activates a menu choice pressed at its reported rectangle", async () => {
  h.debug.reset();
  openMenu(h, "mapselect");

  const choice = menuControl(h, "map-switchyard");
  assertEqual(
    choice.disabled,
    false,
    "the Switchyard choice to be offered rather than disabled (specs/ui.md)",
  );
  await clickControl(h, choice);
  captureStill(h, "press");

  const landed = h.snapshot();
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
