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
// NOTHING HERE ASSUMES A COORDINATE. The press lands where the build said its own
// control is, so a build that draws its controls somewhere else and reports them
// honestly still passes, and one whose reported rectangles are decorative fails.
//
// ONE READING PER CHECK. The four readings are four separate surfaces a build can
// get right or wrong independently, so each is its own point: a build whose menu
// pointer works and whose status-bar pointer does not has to grade differently from
// one where neither does.
//
// THE THREE CONTROLS. `statusControls` reports five, and three of them commit an
// effect a snapshot reads straight back: the recipe-book toggle opens the overlay,
// the speed control steps the multiplier one place, and the mute control flips the
// bit. The remaining two — the damage toggle and the pause control — are the same
// bar and the same rule, and each has a point of its own on the status-bar
// checklist.

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
