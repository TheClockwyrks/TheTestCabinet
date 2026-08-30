// input/pointer-activates-control — a press at a reported rectangle activates its
// control.
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
// HOW IT IS DECIDED. One control is taken from each of the four readings and
// pressed at the centre of the rectangle the BUILD itself reported for it, and
// the effect that control commits is read back:
//
//   `menuButtons`   — the map select's Switchyard choice: the difficulty select,
//                     on the Switchyard.
//   `statusControls` — the recipe-book toggle, the speed control and the mute
//                     control: the overlay opens, the multiplier steps, the bit
//                     flips.
//   `panelButtons`  — the inspector's targeting control on a selected firing
//                     component: the priority steps one place.
//   `pressControls` — the build panel's own press control: a rock is armed on the
//                     cursor.
//
// Nothing here assumes a coordinate. Every press lands where the build said its
// own control is, so a build that draws its controls somewhere else and reports
// them honestly still passes, and one whose reported rectangles are decorative
// fails.

import { afterEach, beforeEach, it } from "vitest";

import { SPEEDS } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  menuControl,
  openMenu,
  openYard,
  panelControl,
  pressControl,
  standComponent,
  statusControl,
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
  assertEqual(
    h.snapshot().muted,
    !before.muted,
    "pressing the centre of the reported `mute` rectangle to toggle the mute " +
      "bit (specs/instrumentation.md, specs/hud.md)",
  );
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

  assertEqual(
    structureById(h.snapshot(), id).targeting,
    targetingAfter(start!, 1),
    "pressing the centre of the reported `targeting` rectangle to step the " +
      "priority one place (specs/instrumentation.md, specs/controls.md)",
  );
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

  assertEqual(
    h.snapshot().held.active,
    true,
    "pressing the centre of the reported `stamp` rectangle to pull the press " +
      "and arm a rock on the cursor (specs/instrumentation.md, " +
      "specs/scrap-press.md)",
  );
});
