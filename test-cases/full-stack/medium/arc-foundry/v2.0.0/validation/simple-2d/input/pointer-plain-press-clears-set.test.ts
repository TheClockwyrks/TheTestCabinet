// input/pointer-plain-press-clears-set — a press with `modify` released clears the
// combine set.
//
// THE REQUIREMENT. `specs/controls.md`: "A press with `modify` released clears the
// set back to a single selection." It is the counterpart of the modified press,
// and it is what lets a player abandon a half-built fold by pointing somewhere
// else rather than un-picking it piece by piece. The requirement holds however
// many pieces the set held, which is why the set here is built up to three before
// the plain press lands.
//
// HOW IT IS DECIDED. Three base structures stand on an otherwise empty yard and
// all three are put into the explicit combine set with modified presses, which is
// the way a player builds one. One of them is then pressed with the modify key
// released, and the set is read: the two the press was not on are gone, and the
// pressed piece is the primary selection.
//
// As in `pointer-selects`, the check does not insist on whether the pressed piece
// itself remains listed in the set, because "back to a single selection" is
// honoured either way. What it insists on is that the other two do not survive.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  clickStructure,
  createHarness,
  openYard,
  standComponent,
  withModify,
  type Harness,
} from "../harness";

/** Three footprints clear of the chain and of each other. */
const ANCHORS = [
  { col: 10, row: 0 },
  { col: 13, row: 0 },
  { col: 16, row: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("clears a three-piece set back to the piece the plain press landed on", async () => {
  openYard(h);
  const ids: number[] = [];
  for (const anchor of ANCHORS) {
    ids.push(standComponent(h, "capacitor", 2, anchor.col, anchor.row));
  }
  h.debug.clearSelection();

  await withModify(h, async () => {
    for (const anchor of ANCHORS)
      await clickStructure(h, anchor.col, anchor.row);
  });
  assertLength(
    h.snapshot().combineSet,
    ANCHORS.length,
    "a combine set built up to three pieces by three modified presses " +
      "(specs/controls.md)",
  );

  const pressed = ids[0]!;
  await clickStructure(h, ANCHORS[0]!.col, ANCHORS[0]!.row);
  captureStill(h, "cleared");

  const after = h.snapshot();
  assertEqual(
    after.selected,
    pressed,
    "the piece an unmodified press landed on, which becomes the primary " +
      "selection (specs/controls.md)",
  );
  assertDeepEqual(
    after.combineSet.filter((id) => id !== pressed),
    [],
    "the combine set after an unmodified press, which is cleared back to a " +
      "single selection however many pieces it held (specs/controls.md)",
  );
});
