// input/pointer-activates-press-control — a press at a reported build-panel
// rectangle activates that control.
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
// one is about `pressControls`, the build panel's own two controls.
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
  openYard,
  pressControl,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("activates the panel's own press control pressed at its reported rectangle", async () => {
  openYard(h);

  const control = pressControl(h, "stamp");
  assertEqual(
    control.disabled,
    false,
    "the press control to be offered in a build phase with the allowance " +
      "untouched (specs/hud.md)",
  );
  await clickControl(h, control);
  captureStill(h, "press");

  assertEqual(
    h.snapshot().held.active,
    true,
    "pressing the centre of the reported `stamp` rectangle to pull the press " +
      "and arm a rock on the cursor (specs/instrumentation.md, " +
      "specs/scrap-press.md)",
  );
});
