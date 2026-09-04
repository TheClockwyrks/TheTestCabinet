// instrumentation/waste-sets-pose — the waste's set memory is posed and read back.
//
// specs/instrumentation.md: `addWasteSet(count)` "appends one set of `count` cards
// to the newest end of the waste's set memory" and `clearWasteSets()` "empties the
// waste's set memory, leaving the cards on the waste standing", both reported by
// `wasteSets`, and `wasteVisibleCount` "is the newest set's count, and `0` when the
// memory is empty".
//
// WHY THE SUITE RESTS ON IT. The set memory is the state the fold-in fix exists to
// pin down: specs/stock.md decides what the waste SHOWS from it, which decides
// which card may be played and what the fan draws, and `poseWaste` in `harness.ts`
// poses it on every scenario that needs a waste. A build whose memory cannot be
// posed cannot be asked those questions at all.
//
// THE TWO COUNTS ARE `2` THEN `3`, ON A WASTE OF FIVE, so every wrong model of
// `wasteVisibleCount` reads as a different number: the newest set is `3`, the
// oldest is `2`, the number of sets is `2`, the sum is `5` and the cards on the
// waste are `5`. A build that reported any of the four wrong answers is named by
// the figure it reported.
//
// THE ORDER IS READ TOO. `wasteSets` is reported oldest first
// (specs/instrumentation.md), so a build that appended to the wrong end reports
// `[3, 2]` and fails on the list even where its `wasteVisibleCount` happens to
// agree.
//
// THE CARDS ARE POSED FIRST, AND SEPARATELY. `addCard` "touches no other field, the
// waste's set memory included", so a waste holding five cards and remembering
// nothing is the state this check starts from, and specs/stock.md gives it a
// meaning: such a waste shows no card. That is the `0` the first reading takes.
//
// WHAT IT DOES NOT DECIDE. Nothing about what a TURN puts on the waste or what
// happens as sets are played off; those are `stock.turn-starts-a-set`,
// `stock.set-shrinks-on-play` and the two `set-falls-back` items.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  posePile,
  type Harness,
} from "../harness";

/** The cards posed on the waste, bottom first, before any set is remembered. */
const WASTE = ["2C", "9H", "4S", "7D", "JC"];

/** The two sets appended, in the order they are appended: oldest first. */
const OLDER_SET = 2;
const NEWER_SET = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("appends each set, reports them oldest first, and shows the newest", async () => {
  openTable(h);
  posePile(h, "waste", 0, WASTE);

  // A waste holding cards and remembering no set shows none of them
  // (specs/stock.md), which is the `0` specs/instrumentation.md fixes for an
  // empty memory.
  const bare = h.snapshot();
  assertLength(bare.waste, WASTE.length, "the cards posed on the waste");
  assertDeepEqual(bare.wasteSets, [], "the set memory before any set is posed");
  assertEqual(
    bare.wasteVisibleCount,
    0,
    "wasteVisibleCount on a waste whose set memory is empty " +
      "(specs/instrumentation.md)",
  );

  h.debug.addWasteSet(OLDER_SET);
  const one = h.snapshot();
  assertDeepEqual(
    one.wasteSets,
    [OLDER_SET],
    "the set memory after one addWasteSet (specs/instrumentation.md)",
  );
  assertEqual(
    one.wasteVisibleCount,
    OLDER_SET,
    "wasteVisibleCount with one set remembered",
  );

  h.debug.addWasteSet(NEWER_SET);
  const two = h.snapshot();

  // The waste and the two sets posed on it.
  await h.advance(1);
  captureStill(h, "waste");

  assertDeepEqual(
    two.wasteSets,
    [OLDER_SET, NEWER_SET],
    "the set memory after the second addWasteSet: sets are reported oldest " +
      "first and appended to the newest end (specs/instrumentation.md)",
  );
  assertEqual(
    two.wasteVisibleCount,
    NEWER_SET,
    "wasteVisibleCount is the newest set's count, not the oldest's, not the " +
      "number of sets and not the cards on the waste " +
      "(specs/instrumentation.md)",
  );
  assertLength(
    two.waste,
    WASTE.length,
    "the cards on the waste, which posing a set never changes",
  );

  h.debug.clearWasteSets();
  const cleared = h.snapshot();
  assertDeepEqual(
    cleared.wasteSets,
    [],
    "the set memory after clearWasteSets (specs/instrumentation.md)",
  );
  assertEqual(
    cleared.wasteVisibleCount,
    0,
    "wasteVisibleCount once the memory is empty (specs/instrumentation.md)",
  );
  assertLength(
    cleared.waste,
    WASTE.length,
    "the cards on the waste, which clearWasteSets leaves standing " +
      "(specs/instrumentation.md)",
  );
});
