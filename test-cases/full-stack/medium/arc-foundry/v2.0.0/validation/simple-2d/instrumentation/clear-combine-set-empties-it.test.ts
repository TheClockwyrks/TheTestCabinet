// instrumentation/clear-combine-set-empties-it — emptied means empty.
//
// `specs/instrumentation.md` gives three operations over the same two readings,
// and they differ in exactly which they touch: `select(id)` "Selects a structure
// ... and clears the combine set back to that single selection";
// `clearCombineSet` "Empties the explicit combine set and leaves the selection as
// it is"; `clearSelection` "Clears the selection and the combine set." The
// snapshot's resting values list `combineSet` under "empty", so an emptied set
// reads as an empty array and not as a set of one.
//
// WHY IT IS ITS OWN POINT. `specs/scrap-press.md` hangs a rule on the difference:
// "With an explicit combine set, the combine folds exactly the pieces in that set.
// With no explicit set, the game resolves the ingredients itself." A build that
// derives the reading from the selection — reporting `[selected]` whatever the
// player did — can never report an emptied set, so a check that empties the set
// and then combines has no way of saying which of the two rules it was under.
//
// THREE READINGS, ONE POSE. The three operations are read in the order that
// separates them, on one selected structure, with nothing else on the yard.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";

/** An anchor clear of the Substation's chain, its entry and its collector. */
const ANCHOR = { col: 10, row: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("empties the set while the selection stands, and clears both together", async () => {
  openYard(h);
  const id = standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);

  h.debug.select(id);
  const selected = h.snapshot();
  assertEqual(selected.selected, id, "the selection select(id) made");
  assertDeepEqual(
    selected.combineSet,
    [id],
    "the combine set select(id) leaves: that single selection " +
      "(specs/instrumentation.md)",
  );

  h.debug.clearCombineSet();
  captureStill(h, "cleared");
  const emptied = h.snapshot();
  assertLength(
    emptied.combineSet,
    0,
    "the combine set after clearCombineSet, which empties it " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    emptied.selected,
    id,
    "the selection after clearCombineSet, which leaves it as it is " +
      "(specs/instrumentation.md)",
  );

  h.debug.clearSelection();
  const cleared = h.snapshot();
  assertNull(cleared.selected, "the selection after clearSelection");
  assertLength(
    cleared.combineSet,
    0,
    "the combine set after clearSelection, which clears both " +
      "(specs/instrumentation.md)",
  );
});
