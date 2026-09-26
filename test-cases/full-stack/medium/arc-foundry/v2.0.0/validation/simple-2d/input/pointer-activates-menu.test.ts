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
// NOTHING HERE ASSUMES A COORDINATE. The press lands where the build said its own
// control is, so a build that draws its controls somewhere else and reports them
// honestly still passes, and one whose reported rectangles are decorative fails.
//
// ONE READING PER CHECK. The four readings are four separate surfaces a build can
// get right or wrong independently, so each is its own point: a build whose menu
// pointer works and whose status-bar pointer does not has to grade differently from
// one where neither does.
//
// THE CHOICE. The map select's Switchyard entry, taken at the centre of the
// rectangle `menuButtons` reported for it: the run lands on the difficulty select,
// on the Switchyard.

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
