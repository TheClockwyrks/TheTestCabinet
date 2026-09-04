// input/pointer-selects — a press on a structure selects it.
//
// THE REQUIREMENT. `specs/controls.md`: "Press on a structure — Selects it as the
// primary selection", and, on the line below, "A press with `modify` released
// clears the set back to a single selection."
// `specs/instrumentation.md` says the same of the operation that stands for this
// press: it "selects a structure, as a pointer press on it would, and clears the
// combine set back to that single selection."
//
// HOW IT IS DECIDED. Two base structures stand on an otherwise empty yard and both
// are put into the explicit combine set, so the set holds something a press has to
// clear. One of them is then pressed at its own centre, with no modifier held, and
// two things are read: it is the primary selection, and the OTHER piece is no
// longer in the combine set. The second read is the one that matters — a build
// that moves the selection and leaves a stale set folds pieces the player is no
// longer pointing at.
//
// The check does not insist on whether the pressed piece itself remains listed in
// the set, because "back to that single selection" is honoured by a build that
// lists it and by one that empties the set and leans on `selected`. What it
// insists on is that nothing else survives.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  clickStructure,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";

/** Two footprints clear of the chain and of each other. */
const PRESSED = { col: 10, row: 0 };
const OTHER = { col: 13, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("makes the pressed structure the primary selection and clears the set", async () => {
  await openYard(h);
  const pressed = await standComponent(
    h,
    "capacitor",
    2,
    PRESSED.col,
    PRESSED.row,
  );
  const other = await standComponent(h, "emitter", 2, OTHER.col, OTHER.row);

  await h.debug.addToCombineSet(pressed);
  await h.debug.addToCombineSet(other);
  assertLength(
    (await h.snapshot()).combineSet,
    2,
    "an explicit combine set holding both pieces before the press " +
      "(specs/instrumentation.md)",
  );

  await clickStructure(h, PRESSED.col, PRESSED.row);
  await captureStill(h, "select");

  const after = await h.snapshot();
  assertEqual(
    after.selected,
    pressed,
    `pressing the structure at (${PRESSED.col}, ${PRESSED.row}) to make it the ` +
      "primary selection (specs/controls.md)",
  );
  assertDeepEqual(
    after.combineSet.filter((id) => id !== pressed),
    [],
    "the combine set after an unmodified press, which is cleared back to that " +
      "single selection (specs/controls.md)",
  );
});
