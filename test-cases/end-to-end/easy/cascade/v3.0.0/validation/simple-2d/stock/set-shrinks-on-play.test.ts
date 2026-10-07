// stock/set-shrinks-on-play — a card played off the waste comes out of its set.
//
// THE RULE. specs/stock.md: "Playing the top card off the waste leaves its set one
// card smaller". The waste shows the cards of the newest set that still holds any,
// and `wasteVisibleCount` is that set's count (specs/instrumentation.md), so a set
// that loses a card leaves the waste showing one card fewer. A build that let the
// count stand would keep drawing a card it no longer holds.
//
// THE SHOWN SET HOLDS TWO, so the reading is the SHRINK and not the fallback. A set
// played off entirely leaves the memory and the waste falls back to the set turned
// before it, which is a different rule and a different point: `draw-one.set-falls-back`
// and `draw-three.set-falls-back` decide it, each on the sequence its own deal mode
// reaches it by. Here the set still holds a card afterwards, so what is read is one
// entry going from two to one and the count following it.
//
// THE MEMORY IS POSED, NOT TURNED. specs/instrumentation.md's `addWasteSet(count)`
// appends one set of `count` cards, without restriction, and specs/stock.md states
// the shrinking rule for a set of any size, so a set of two is a state either deal
// mode's build is asked to handle. Turning for it instead would need three cards on
// one set, which only one of the two deal modes can produce, and this point is
// common to both.
//
// AN OLDER SET SITS BENEATH IT, so a build that shrank the OLDEST entry, or the
// whole memory, is caught: the older entry has to come through untouched.
//
// THE PLAY IS AN ACE ONTO AN EMPTY FOUNDATION, the one move in the game that needs
// nothing built first (specs/foundations.md). Its acceptance is asserted before the
// memory is read, because a refused move plays nothing and there would be no shrink
// to decide; that the waste's top card reaches a foundation at all is
// `stock/waste-top-to-foundation`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

/**
 * The waste the play comes off: three cards, an older set of one under a newer set
 * of two. The Ace of spades is the top card and the empty foundation takes it.
 */
const POSED_WASTE = ["2C", "9D", "AS"] as const;
const POSED_SETS = [1, 2] as const;

/** The row the Ace sits at, counted from the bottom of the waste. */
const ACE_ROW = POSED_WASTE.length - 1;

/** The foundation the Ace goes home to: empty, so it accepts an Ace of any suit. */
const FOUNDATION = 0;

/** The memory the play must leave: the older set as it was, the newer one smaller. */
const EXPECTED_SETS = [1, 1];

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("takes the played card off the newest set and lowers the shown count", async () => {
  openTable(harness);
  poseWaste(harness, POSED_WASTE, POSED_SETS);

  const accepted = harness.debug.move(
    "waste",
    0,
    ACE_ROW,
    "foundation",
    FOUNDATION,
  );

  await harness.advance(1);
  captureStill(harness, "played");

  assertEqual(
    accepted,
    true,
    "move() to accept the waste's Ace onto an empty foundation, which is the " +
      "play whose effect on the set memory is read here (specs/foundations.md)",
  );

  const after = harness.snapshot();
  assertDeepEqual(
    after.wasteSets,
    EXPECTED_SETS,
    "the waste's set memory after its top card was played, the newest set one " +
      "card smaller and the older one untouched (specs/stock.md)",
  );
  assertEqual(
    after.wasteVisibleCount,
    EXPECTED_SETS[EXPECTED_SETS.length - 1],
    "wasteVisibleCount after the play, which is the newest set's count " +
      "(specs/instrumentation.md)",
  );
});
