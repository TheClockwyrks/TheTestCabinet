// input/pointer-clears-selection — a press on open yard clears the selection.
//
// THE REQUIREMENT. `specs/controls.md`: "Press on empty yard — Clears the
// selection." `specs/instrumentation.md` reports both halves of what a selection
// is, `selected` and `combineSet`, and pairs them everywhere else: the operation
// that clears a selection "clears the selection and the combine set". So a press
// on nothing leaves nothing selected and nothing set aside to fold.
//
// HOW IT IS DECIDED. One base structure stands on an otherwise empty yard, is
// selected, and is put into the explicit combine set, so there is a selection to
// lose. The pointer is then pressed at the centre of a tile well clear of it, with
// nothing held on the cursor, and both fields are read back.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  clickTile,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";

/** Where the structure stands, and a tile of open yard well clear of it. */
const ANCHOR = { col: 10, row: 0 };
const OPEN = { col: 30, row: 10 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("clears the selection and the combine set on a press over open yard", async () => {
  openYard(h);
  const id = standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  h.debug.select(id);
  h.debug.addToCombineSet(id);

  const posed = h.snapshot();
  assertEqual(
    posed.selected,
    id,
    "a structure selected before the press (specs/instrumentation.md)",
  );
  assertEqual(
    posed.held.active,
    false,
    "nothing held on the cursor, so the press is a press on the yard rather " +
      "than a drop (specs/controls.md)",
  );

  await clickTile(h, OPEN.col, OPEN.row);
  captureStill(h, "cleared");

  const after = h.snapshot();
  assertNull(
    after.selected,
    `pressing open yard at (${OPEN.col}, ${OPEN.row}) to clear the selection ` +
      "(specs/controls.md)",
  );
  assertDeepEqual(
    after.combineSet,
    [],
    "the combine set after the selection is cleared " +
      "(specs/instrumentation.md)",
  );
});
