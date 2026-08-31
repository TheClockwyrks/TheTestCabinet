// instrumentation/waste-sets-pose — the waste's set memory is posed, read back,
// and emptied, and `wasteVisibleCount` follows the newest entry.
//
// THE RULE. specs/instrumentation.md, under The waste's sets:
// "`addWasteSet(count)` — Appends one set of `count` cards to the newest end of
// the waste's set memory" and "`clearWasteSets()` — Empties the waste's set
// memory, leaving the cards on the waste standing", with "`wasteVisibleCount`
// is the newest set's count, and `0` when the memory is empty."
//
// `wasteVisibleCount` IS A CONSEQUENCE, NOT A COUNTER. specs/stock.md defines
// the memory: the waste keeps each turn's cards together as a set, remembers the
// sets oldest first, and SHOWS the cards it holds from the newest set that still
// holds any. So what the waste shows is derived from the memory's newest entry —
// which is why this point poses the memory and reads the derivation, rather than
// posing a count and reading it back.
//
// THE THREE FIGURES ARE ALL DIFFERENT, so every wrong model reads a different
// number. Five cards stand on the waste under two sets of `2` and `3`. A build
// reporting the newest entry reads `3`; the oldest, `2`; the number of sets,
// `2`; the cards on the waste, `5`; the sets' total, `5`. Only one of those is
// the answer, and the failure says which the build computed.
//
// AND THE MEMORY IS READ BEFORE, BETWEEN AND AFTER, in three readings:
//   - empty, over a waste that already holds its five cards — read as holding
//     them, since a count of `0` over a waste holding nothing would say nothing
//     — where the count is `0` "whatever cards it still holds";
//   - after the two sets are appended, where `wasteSets` reports them oldest
//     first and the count follows the newest;
//   - after `clearWasteSets`, where the memory is empty again and the five
//     cards are still on the waste, because the operation leaves them standing.
//
// WHAT IT DOES NOT DECIDE. That a TURN appends a set is
// `stock.turn-starts-a-set`, that playing the top card shrinks one is
// `stock.set-shrinks-on-play`, and that a set played off entirely falls back to
// the one before it is `draw-one/set-falls-back`. This point is the pose.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  FIVE,
  FOUR,
  NINE,
  SEVEN,
  TWO,
  captureStill,
  card,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

/** The five cards on the waste, bottom-most first. */
const WASTE_CARDS = [
  card("clubs", TWO),
  card("hearts", FOUR),
  card("spades", FIVE),
  card("diamonds", SEVEN),
  card("clubs", NINE),
];

/** The two sets appended, oldest first, at two different counts. */
const OLDER_SET = 2;
const NEWER_SET = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("appends a set, reports the memory, and empties it, with the shown count following the newest entry", async () => {
  openTable(h);
  // The five cards, with NO sets: the memory is posed below, one set at a time.
  poseWaste(h, WASTE_CARDS, []);

  const bare = h.snapshot();
  assertLength(
    bare.waste,
    WASTE_CARDS.length,
    "cards posed on the waste the memory is read over: the count that follows " +
      "is 0 whatever cards the waste holds, which says nothing at all over a " +
      "waste holding none",
  );
  assertLength(
    bare.wasteSets,
    0,
    "entries in the waste's set memory before any set is posed",
  );
  assertEqual(
    bare.wasteVisibleCount,
    0,
    `cards the waste shows with an empty set memory over ` +
      `${WASTE_CARDS.length} cards: the count is 0 when the memory is empty, ` +
      "whatever cards the waste still holds (specs/instrumentation.md)",
  );

  // The FIRST set alone, read before the second is posed: one call appends one
  // entry, and the shown count follows it while it is the newest one there is.
  h.debug.addWasteSet(OLDER_SET);
  const one = h.snapshot();
  assertDeepEqual(
    one.wasteSets,
    [OLDER_SET],
    "the waste's set memory after ONE addWasteSet call: it appends exactly " +
      "that one entry (specs/instrumentation.md)",
  );
  assertEqual(
    one.wasteVisibleCount,
    OLDER_SET,
    `cards the waste shows over a single set of ${OLDER_SET} on a waste ` +
      `holding ${WASTE_CARDS.length}: the count is the newest set's, which is ` +
      "the only set there is (specs/instrumentation.md)",
  );

  h.debug.addWasteSet(NEWER_SET);
  const posed = h.snapshot();

  await h.advance(1);
  captureStill(h, "waste");

  assertDeepEqual(
    posed.wasteSets,
    [OLDER_SET, NEWER_SET],
    "the waste's set memory after two addWasteSet calls: each appends one " +
      "set to the newest end, and the memory reads oldest first " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    posed.wasteVisibleCount,
    NEWER_SET,
    "cards the waste shows over sets of " +
      `${OLDER_SET} and ${NEWER_SET} on a waste holding ` +
      `${WASTE_CARDS.length}: the count is the newest set's ` +
      "(specs/instrumentation.md)",
  );

  h.debug.clearWasteSets();
  const cleared = h.snapshot();

  assertLength(
    cleared.wasteSets,
    0,
    "entries left in the waste's set memory after clearWasteSets " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    cleared.wasteVisibleCount,
    0,
    "cards the waste shows once its memory has been emptied " +
      "(specs/instrumentation.md)",
  );
  assertLength(
    cleared.waste,
    WASTE_CARDS.length,
    "cards left on the waste after clearWasteSets, which empties the memory " +
      "and leaves the cards standing (specs/instrumentation.md)",
  );
});
