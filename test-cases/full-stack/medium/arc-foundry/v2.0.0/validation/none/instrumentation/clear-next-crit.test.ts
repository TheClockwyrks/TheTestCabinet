// instrumentation/clear-next-crit — `clearNextCrit` takes the arming off a
// structure and touches nothing else about it.
//
// `specs/instrumentation.md`: "Clears the arming and returns the structure's next
// shot to its random crit roll." The arming is read on, cleared, and read off
// with no shot fired in between, and the rest of the structure's entry is held
// against what it read before the arming, so a clear that resets a tally, a
// level or a priority shows.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { comboDef } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standCombo,
  structureById,
  type Harness,
  type StructureView,
} from "../harness";

const TOWER = comboDef("slagdriver");

/** Where the tower stands, clear of the Substation's chain. */
const ANCHOR = { col: 12, row: 12 };

/** Everything a structure reports apart from the arming itself. */
function apartFromArming(structure: StructureView): unknown {
  const { nextCrit: _nextCrit, ...rest } = structure;
  return rest;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves nextCrit null and the rest of the structure as it was", async () => {
  await openYard(h);
  const id = await standCombo(h, TOWER.id, ANCHOR.col, ANCHOR.row);
  const before = structureById(await h.snapshot(), id);

  await h.debug.setNextCrit(id, true);
  assertEqual(
    structureById(await h.snapshot(), id).nextCrit,
    true,
    "the arming to clear",
  );

  await h.debug.clearNextCrit(id);
  await h.advance(1);
  await captureStill(h, "cleared");
  const after = structureById(await h.snapshot(), id);
  assertNull(
    after.nextCrit,
    "nextCrit after clearNextCrit (specs/instrumentation.md)",
  );
  assertDeepEqual(
    apartFromArming(after),
    apartFromArming(before),
    "the structure's entry apart from its arming, which the clear leaves alone",
  );
});
