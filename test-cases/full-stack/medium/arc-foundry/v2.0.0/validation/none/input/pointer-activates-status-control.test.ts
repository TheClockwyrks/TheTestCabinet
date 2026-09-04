// input/pointer-activates-status-control — a press at a reported status-bar
// rectangle activates its control.
//
// THE REQUIREMENT. `specs/controls.md`: "Every screen and every control is fully
// operable with the pointer alone", and "A press at the center of a control's
// drawn rectangle activates it." `specs/instrumentation.md` states the same rule
// from the reading's side for `statusControls`, whose rectangles are "the
// control's real hit region".
//
// HOW IT IS DECIDED. Three of the bar's five controls are pressed at the centre
// of the rectangle the BUILD reported for each, and the value each commits is
// read back: the recipe book opens, the multiplier steps one place, the mute bit
// flips. They share one point because they exercise one requirement the same way
// — a press at a reported bar rectangle reaches that bar control — and each is
// read as the change it made, so a build that wires two of them to one place
// fails here.

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

afterEach(async () => {
  await h.dispose();
});

it("activates each status-bar control pressed at its reported rectangle", async () => {
  await openYard(h);

  const before = await h.snapshot();

  await clickControl(h, await statusControl(h, "combos"));
  await captureStill(h, "press");
  assertEqual(
    (await h.snapshot()).overlays.combos,
    true,
    "pressing the centre of the reported `combos` rectangle to open the " +
      "recipe book (specs/instrumentation.md, specs/hud.md)",
  );

  await clickControl(h, await statusControl(h, "speed"));
  assertEqual(
    (await h.snapshot()).speed,
    SPEEDS[
      (SPEEDS.indexOf(before.speed as (typeof SPEEDS)[number]) + 1) %
        SPEEDS.length
    ],
    "pressing the centre of the reported `speed` rectangle to step the " +
      "multiplier one place (specs/controls.md)",
  );

  await clickControl(h, await statusControl(h, "mute"));
  assertEqual(
    (await h.snapshot()).muted,
    !before.muted,
    "pressing the centre of the reported `mute` rectangle to toggle the mute " +
      "bit (specs/instrumentation.md, specs/hud.md)",
  );
});
