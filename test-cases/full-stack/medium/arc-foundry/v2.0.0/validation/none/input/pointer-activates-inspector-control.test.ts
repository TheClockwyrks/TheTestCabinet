// input/pointer-activates-inspector-control — a press at a reported inspector
// rectangle activates its action.
//
// THE REQUIREMENT. `specs/controls.md`: "Every screen and every control is fully
// operable with the pointer alone", and "A press at the center of a control's
// drawn rectangle activates it." `specs/instrumentation.md` states the same rule
// from the reading's side for `panelButtons`, whose rectangles are "the control's
// real hit region".
//
// HOW IT IS DECIDED. A firing component is stood up and selected, its targeting
// control is taken from `panelButtons`, and it is pressed at the centre of the
// rectangle the BUILD reported for it. What the control commits is read back off
// the structure: the priority steps one place along the cycle
// `specs/components.md` fixes. Nothing here assumes a coordinate.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  openYard,
  panelControl,
  standComponent,
  structureById,
  targetingAfter,
  type Harness,
} from "../harness";

/** Where the inspected component stands: clear of the chain. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("activates an inspector control pressed at its reported rectangle", async () => {
  await openYard(h);
  const id = await standComponent(h, "capacitor", 3, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);

  const start = structureById(await h.snapshot(), id).targeting;
  assertNotNull(
    start,
    "a firing structure to report a targeting priority " +
      "(specs/instrumentation.md)",
  );

  const control = await panelControl(h, "targeting");
  assertEqual(
    control.disabled,
    false,
    "the inspector's targeting control to be offered on a selected firing " +
      "structure, which is available in every phase (specs/controls.md)",
  );
  await clickControl(h, control);
  await captureStill(h, "press");

  assertEqual(
    structureById(await h.snapshot(), id).targeting,
    targetingAfter(start!, 1),
    "pressing the centre of the reported `targeting` rectangle to step the " +
      "priority one place (specs/instrumentation.md, specs/controls.md)",
  );
});
