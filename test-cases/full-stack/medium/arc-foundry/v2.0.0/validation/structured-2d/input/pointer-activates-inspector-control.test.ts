// input/pointer-activates-inspector-control — a press at a reported inspector
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
// one is about `panelButtons`, the inspector's action controls.
//
// Nothing here assumes a coordinate. The press lands where the build said its own
// control is, so a build that draws its controls somewhere else and reports them
// honestly still passes, and one whose reported rectangles are decorative fails.

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

afterEach(() => {
  h.dispose();
});

it("activates an inspector control pressed at its reported rectangle", async () => {
  openYard(h);
  const id = standComponent(h, "capacitor", 3, ANCHOR.col, ANCHOR.row);
  h.debug.select(id);

  const start = structureById(h.snapshot(), id).targeting;
  assertNotNull(
    start,
    "a firing structure to report a targeting priority " +
      "(specs/instrumentation.md)",
  );

  const control = panelControl(h, "targeting");
  assertEqual(
    control.disabled,
    false,
    "the inspector's targeting control to be offered on a selected firing " +
      "structure, which is available in every phase (specs/controls.md)",
  );
  await clickControl(h, control);
  captureStill(h, "press");

  assertEqual(
    structureById(h.snapshot(), id).targeting,
    targetingAfter(start!, 1),
    "pressing the centre of the reported `targeting` rectangle to step the " +
      "priority one place (specs/instrumentation.md, specs/controls.md)",
  );
});
