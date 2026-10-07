// instrumentation/clear-combine-set-keeps-the-selection — `clearCombineSet`
// leaves the selection standing.
//
// `specs/instrumentation.md` gives three operations over the same two readings,
// and they differ in exactly which they touch: `select(id)` "Selects a structure
// ... and clears the combine set back to that single selection";
// `clearCombineSet` "Empties the explicit combine set and leaves the selection as
// it is"; `clearSelection` "Clears the selection and the combine set." The
// snapshot's resting values list `combineSet` under "empty", so an emptied set
// reads as an empty array and not as a set of one.
//
// WHY THESE ARE THREE POINTS. `specs/scrap-press.md` hangs a rule on the
// difference: "With an explicit combine set, the combine folds exactly the pieces
// in that set. With no explicit set, the game resolves the ingredients itself." A
// build that derives the reading from the selection — reporting `[selected]`
// whatever the player did — empties nothing; a build that empties the set but
// drops the selection with it makes every check that combines an explicit set
// unable to say which structure it was standing on. Those are different defects
// with different costs, so each of the three claims is decided by name.
//
// WHAT IS DECIDED HERE is the survivor alone. That the set is emptied is
// `clear-combine-set-empties-the-set`, and that `clearSelection` takes both is
// `clear-selection-empties-both`.
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("leaves the selection as it is", async () => {
  openYard(h);
  const id = standComponent(h, "capacitor", 1, ANCHOR.col, ANCHOR.row);

  h.debug.select(id);
  assertEqual(h.snapshot().selected, id, "the selection select(id) made");

  h.debug.clearCombineSet();
  captureStill(h, "cleared");
  assertEqual(
    h.snapshot().selected,
    id,
    "the selection after clearCombineSet, which leaves it as it is " +
      "(specs/instrumentation.md)",
  );
});
