// instrumentation/waste-sets-pose — the waste's set memory is posed one set at a
// time, emptied in one call, and reported back; and `wasteVisibleCount` follows
// the newest entry.
//
// THE RULE. `specs/instrumentation.md`, The waste's sets: `addWasteSet(count)`
// "Appends one set of `count` cards to the newest end of the waste's set memory",
// `clearWasteSets()` "Empties the waste's set memory, leaving the cards on the
// waste standing", and "`wasteVisibleCount` is the newest set's count, and `0`
// when the memory is empty". The snapshot shape says the same of the reported
// field: `wasteSets` is "cards on each turned set, oldest first".
//
// WHY THE MEMORY HAS A POSE AT ALL. `specs/stock.md` makes the memory what
// decides which cards the waste shows: "The waste shows the cards it holds from
// the newest set that still holds any." A posed waste with no memory shows
// nothing, so every scenario in the `stock`, `draw-one` and `draw-three` groups
// that lays a waste lays its sets with it — and none of them means anything
// unless the pose lands and the derivation follows it.
//
// THE FIGURES ARE CHOSEN SO EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. Six
// cards on the waste, then a set of two and a set of three. `wasteVisibleCount`
// is `3` by the rule; `2` is a build reporting the OLDEST set; `5` is a build
// summing the memory; `6` is a build reporting the whole pile; and `0` is a build
// whose `addWasteSet` appended nothing. The cards the sets do not reach are the
// buried remainder, which is a state `specs/stock.md` defines rather than an
// accident.
//
// AND THE CLEAR IS READ ON BOTH HALVES: the memory is empty afterwards, the
// derived count falls to `0` with it, and the six cards are still on the waste —
// a build whose `clearWasteSets` also swept the pile fails on the cards while
// passing on the memory.
//
// WHAT THIS DOES NOT DECIDE. What a TURN puts on the memory, or what playing a
// card off it takes away — `stock/turn-starts-a-set`, `stock/set-shrinks-on-play`
// and `draw-three/set-falls-back` drive the build's own stock code for that. This
// point decides the pose and the derivation alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

/** The cards laid on the waste, bottom card first. Six, so no wrong model reads 6. */
const WASTE = ["2C", "3D", "4S", "5H", "6D", "7C"] as const;

/** The two sets appended, oldest first. */
const OLDEST_SET = 2;
const NEWEST_SET = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends a set, empties the memory, and counts the newest set", async () => {
  await openTable(h);
  // Laid with no sets: a waste whose memory is empty is a state
  // `specs/stock.md` defines, and it is what the first reading below is of.
  await poseWaste(h, cards(...WASTE), []);

  // Each reading is taken with no frame between it and the pose before it.
  const bare = await h.snapshot();
  await h.debug.addWasteSet(OLDEST_SET);
  const one = await h.snapshot();
  await h.debug.addWasteSet(NEWEST_SET);
  const two = await h.snapshot();
  await h.debug.clearWasteSets();
  const cleared = await h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing pose still leaves the picture of the
  // waste and the sets posed onto it.
  await captureStill(h, "waste");

  assertLength(
    bare.wasteSets,
    0,
    `the waste's set memory as it was laid, before any set was appended`,
  );
  assertEqual(
    bare.wasteVisibleCount,
    0,
    `snapshot().wasteVisibleCount on a waste of ${WASTE.length} cards whose ` +
      `set memory is empty, which the specification fixes at 0`,
  );

  assertDeepEqual(
    one.wasteSets,
    [OLDEST_SET],
    `snapshot().wasteSets after addWasteSet(${OLDEST_SET}) on an empty memory`,
  );
  assertEqual(
    one.wasteVisibleCount,
    OLDEST_SET,
    `snapshot().wasteVisibleCount with one set of ${OLDEST_SET} in the memory`,
  );

  assertDeepEqual(
    two.wasteSets,
    [OLDEST_SET, NEWEST_SET],
    `snapshot().wasteSets after addWasteSet(${NEWEST_SET}), oldest first — ` +
      `the set is appended to the NEWEST end (specs/instrumentation.md)`,
  );
  assertEqual(
    two.wasteVisibleCount,
    NEWEST_SET,
    `snapshot().wasteVisibleCount with sets [${OLDEST_SET}, ${NEWEST_SET}] on ` +
      `a waste of ${WASTE.length} cards — it is the NEWEST set's count, so ` +
      `${OLDEST_SET} is the oldest, ${OLDEST_SET + NEWEST_SET} is the memory ` +
      `summed and ${WASTE.length} is the whole pile`,
  );

  assertLength(
    cleared.wasteSets,
    0,
    "the waste's set memory after clearWasteSets()",
  );
  assertEqual(
    cleared.wasteVisibleCount,
    0,
    "snapshot().wasteVisibleCount once the memory has been emptied",
  );
  assertLength(
    cleared.waste,
    WASTE.length,
    `the cards still on the waste after clearWasteSets(), which leaves them ` +
      `standing (specs/instrumentation.md)`,
  );
});
