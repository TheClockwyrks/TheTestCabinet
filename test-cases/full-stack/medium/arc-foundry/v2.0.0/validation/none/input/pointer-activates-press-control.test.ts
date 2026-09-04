// input/pointer-activates-press-control — a press at the reported press-control
// rectangle pulls the press.
//
// THE REQUIREMENT. `specs/controls.md`: "Every screen and every control is fully
// operable with the pointer alone", and "A press at the center of a control's
// drawn rectangle activates it." `specs/instrumentation.md` states the same rule
// from the reading's side for `pressControls`, whose rectangles are "the
// control's real hit region".
//
// HOW IT IS DECIDED. The build panel's own press control is taken from
// `pressControls` in a build phase with the allowance untouched, and pressed at
// the centre of the rectangle the BUILD reported for it. What it commits is read
// back: a rock armed on the cursor. Nothing here assumes a coordinate.

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

afterEach(async () => {
  await h.dispose();
});

it("activates the panel's own press control pressed at its reported rectangle", async () => {
  await openYard(h);

  const control = await pressControl(h, "stamp");
  assertEqual(
    control.disabled,
    false,
    "the press control to be offered in a build phase with the allowance " +
      "untouched (specs/hud.md)",
  );
  await clickControl(h, control);
  await captureStill(h, "press");

  assertEqual(
    (await h.snapshot()).held.active,
    true,
    "pressing the centre of the reported `stamp` rectangle to pull the press " +
      "and arm a rock on the cursor (specs/instrumentation.md, " +
      "specs/scrap-press.md)",
  );
});
