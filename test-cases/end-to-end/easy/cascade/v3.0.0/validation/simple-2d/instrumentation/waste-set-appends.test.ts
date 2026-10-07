// instrumentation/waste-set-appends — `addWasteSet` appends one set to the newest
// end of the waste's memory, leaving the entries already there in their order.
//
// THE RULE. `specs/instrumentation.md`, The waste's sets: `addWasteSet(count)`
// "Appends one set of `count` cards to the newest end of the waste's set memory."
// The snapshot shape says the same of the reported field: `wasteSets` is "cards
// on each turned set, oldest first".
//
// WHY THE MEMORY HAS A POSE AT ALL. `specs/stock.md` makes the memory what
// decides which cards the waste shows: "The waste shows the cards it holds from
// the newest set that still holds any." A posed waste with no memory shows
// nothing, so every scenario in the `stock`, `draw-one` and `draw-three` groups
// that lays a waste lays its sets with it, and none of them means anything unless
// this pose lands.
//
// TWO SETS ARE APPENDED, NOT ONE, because one could not say which END the
// operation appended to: a build that prepends reads `[3, 2]` where a correct one
// reads `[2, 3]`, and the two counts differ so the failure names the order rather
// than the count.
//
// THREE OPERATIONS ON THE MEMORY, THREE POINTS. `clearWasteSets` is its own
// operation (`instrumentation/waste-sets-clear`) and `wasteVisibleCount` is a
// derived reading rather than either of them
// (`instrumentation/waste-visible-count-follows-newest`), so a build can append
// correctly and derive the shown count wrongly.
//
// WHAT THIS DOES NOT DECIDE. What a TURN puts on the memory, which is
// `stock/turn-starts-a-set`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

/** The cards laid on the waste, bottom card first. */
const WASTE = ["2C", "3D", "4S", "5H", "6D", "7C"] as const;

/** The two sets appended, oldest first. Distinct, so the order is readable. */
const OLDEST_SET = 2;
const NEWEST_SET = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("appends each set to the newest end of the memory", async () => {
  openTable(h);
  // Laid with no sets: a waste whose memory is empty is a state
  // `specs/stock.md` defines, and it is what the first reading below is of.
  await poseWaste(h, [...WASTE], []);

  // Each reading is taken with no frame between it and the pose before it.
  const bare = h.snapshot();
  h.debug.addWasteSet(OLDEST_SET);
  const one = h.snapshot();
  h.debug.addWasteSet(NEWEST_SET);
  const two = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing pose still leaves the picture of the
  // waste and the sets posed onto it.
  captureStill(h, "waste");

  assertLength(
    bare.wasteSets,
    0,
    "the waste's set memory as it was laid, before any set was appended",
  );
  assertDeepEqual(
    one.wasteSets,
    [OLDEST_SET],
    `snapshot().wasteSets after addWasteSet(${OLDEST_SET}) on an empty memory`,
  );
  assertDeepEqual(
    two.wasteSets,
    [OLDEST_SET, NEWEST_SET],
    `snapshot().wasteSets after addWasteSet(${NEWEST_SET}), oldest first — ` +
      `the set is appended to the NEWEST end and the entry already there keeps ` +
      `its place (specs/instrumentation.md)`,
  );
});
