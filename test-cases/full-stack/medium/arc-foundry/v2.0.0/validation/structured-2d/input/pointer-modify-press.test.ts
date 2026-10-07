// input/pointer-modify-press — a press with `modify` held toggles a piece in the
// combine set.
//
// THE REQUIREMENT. `specs/controls.md`: "Press on a base structure while `modify`
// is held — Adds it to the explicit combine set, or removes it if it is already in
// the set." `modify` is the one action that stands for no control at all: it "only
// modifies a pointer press", and it is read as a level rather than as an edge, so
// what the game reads is whether its key is down at the moment of the press.
// `specs/instrumentation.md` reports the set as `combineSet`.
//
// HOW IT IS DECIDED. Two base structures stand on an otherwise empty yard. The
// first is made the primary selection with a plain press, which is how a player
// starts a fold; the SECOND is then pressed twice with the modify key held down
// across each press, and the set is read after each. The first modified press has
// to add it and the second has to take it back out again. Both directions are the
// point: a build that adds on every modified press and never removes leaves a
// player unable to take a piece back out of a fold.
//
// THE KEY IS HELD ACROSS THE FRAME, not merely around the arrangement. `modify` is
// read as a LEVEL inside the frame that resolves the press, so what is wrapped is
// the click itself — the press, the frame that delivers it, and the release.
//
// WHY THE TOGGLE IS READ ON A PIECE THAT IS NOT THE PRIMARY. `specs/controls.md`
// and `specs/instrumentation.md` agree that a modified press toggles a piece in
// the set, and `select(id)` "clears the combine set back to that single
// selection", so the primary itself is reported inside `combineSet`. What neither
// file settles is what a modified press on the PRIMARY does — whether it takes the
// piece out of a set it is the anchor of, or whether the anchor is the one member
// a modified press cannot toggle. The requirement is decided here on the piece
// where both readings agree, so a build honouring either passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  clickStructure,
  createHarness,
  openYard,
  standComponent,
  withModify,
  type Harness,
} from "../harness";

/** Two footprints clear of the chain and of each other. */
const PRIMARY = { col: 10, row: 0 };
const TOGGLED = { col: 13, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("adds a piece to the combine set, and takes it back out again", async () => {
  openYard(h);
  const primary = standComponent(h, "capacitor", 2, PRIMARY.col, PRIMARY.row);
  const toggled = standComponent(h, "capacitor", 2, TOGGLED.col, TOGGLED.row);

  // A plain press starts the fold, so the piece the toggle is read on is not the
  // set's own anchor.
  await clickStructure(h, PRIMARY.col, PRIMARY.row);
  assertEqual(
    h.snapshot().selected,
    primary,
    "the piece a plain press made the primary selection (specs/controls.md)",
  );

  await withModify(h, () => clickStructure(h, TOGGLED.col, TOGGLED.row));
  captureStill(h, "set");
  assertContains(
    h.snapshot().combineSet,
    toggled,
    "the combine set after a press on a base structure made with modify held " +
      "(specs/controls.md)",
  );

  await withModify(h, () => clickStructure(h, TOGGLED.col, TOGGLED.row));
  assertDeepEqual(
    h.snapshot().combineSet.filter((id) => id === toggled),
    [],
    "the combine set after a second modified press on the same piece, which " +
      "removes it (specs/controls.md)",
  );
});
