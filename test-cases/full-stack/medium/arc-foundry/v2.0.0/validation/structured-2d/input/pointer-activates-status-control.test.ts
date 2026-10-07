// input/pointer-activates-status-control — a press at a reported status-bar
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
// one is about `statusControls`, the status bar's own five controls.
//
// Nothing here assumes a coordinate. The press lands where the build said its own
// control is, so a build that draws its controls somewhere else and reports them
// honestly still passes, and one whose reported rectangles are decorative fails.

import { afterEach, beforeEach, it } from "vitest";
import { SPEEDS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  openYard,
  statusControl,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("activates each status-bar control pressed at its reported rectangle", async () => {
  openYard(h);

  const before = h.snapshot();

  await clickControl(h, statusControl(h, "combos"));
  assertEqual(
    h.snapshot().overlays.combos,
    true,
    "pressing the centre of the reported `combos` rectangle to open the " +
      "recipe book (specs/instrumentation.md, specs/hud.md)",
  );

  await clickControl(h, statusControl(h, "speed"));
  assertEqual(
    h.snapshot().speed,
    SPEEDS[
      (SPEEDS.indexOf(before.speed as (typeof SPEEDS)[number]) + 1) %
        SPEEDS.length
    ],
    "pressing the centre of the reported `speed` rectangle to step the " +
      "multiplier one place (specs/controls.md)",
  );

  await clickControl(h, statusControl(h, "mute"));
  captureStill(h, "press");
  assertEqual(
    h.snapshot().muted,
    !before.muted,
    "pressing the centre of the reported `mute` rectangle to toggle the mute " +
      "bit (specs/instrumentation.md, specs/hud.md)",
  );
});
