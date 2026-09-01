// stock/set-shrinks-on-play — playing the waste's top card leaves the set it
// came from ONE CARD SMALLER, and the waste showing one card fewer.
//
// `specs/stock.md`: "Playing the top card off the waste leaves its set one card
// smaller, and a set played off entirely leaves the memory, so the waste falls
// back to what is left of the set turned before it." This point decides the
// first half of that sentence — the shrink — and the fallback in the second half
// is `draw-one/set-falls-back` and `draw-three/set-falls-back`.
//
// THE SET UNDER TEST HOLDS TWO CARDS, because "one card smaller" is only
// observable on a set with a card to spare: a set of one played off leaves the
// memory instead, which is the other half of the rule and another point's. The
// rule `specs/stock.md` states is the waste's, not the deal mode's — it is
// written once, for any set — and `addWasteSet(count)` takes any count
// (`specs/instrumentation.md`), so the memory is posed rather than turned. That
// keeps one common point deciding one rule under both variants.
//
// AN OLDER SET STANDS BEHIND IT, so which set shrank is a reading rather than an
// assumption. Every wrong model reads as a different memory:
//
//   the rule                 [2, 1], showing 1
//   shrinks the oldest set   [1, 2], showing 2
//   drops the whole set      [2], showing 2
//   leaves the memory alone  [2, 2], showing 2
//
// THE CARD IS PLAYED THROUGH THE GAME'S OWN MOVE, onto a foundation that accepts
// it by `specs/foundations.md`, and the move's verdict is asserted: a build that
// refused the play never reached the state the memory reading is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { RANK_MIN } from "../constants";
import {
  captureStill,
  cards,
  createHarness,
  openTable,
  poseFoundation,
  poseWaste,
  type Harness,
} from "../harness";

/** The foundation the played card goes home to, holding the Ace of its suit. */
const FOUNDATION = 0;
const SUIT = "spades" as const;

/**
 * The waste, bottom card first, under a memory of two sets of two: the older
 * pair squared away, the newer pair shown with the `2S` on top.
 */
const WASTE = ["7D", "6C", "9H", "2S"];
const WASTE_SETS = [2, 2];

/** Where the waste's top card sits, counted from the bottom of the pile. */
const TOP_ROW = WASTE.length - 1;

/** The memory the play leaves: the older set untouched, the newer one short. */
const SETS_AFTER = [2, 1];

/** One frame, so the still carries the waste the assertions read. */
const DRAW_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the played card's own set one card smaller", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, RANK_MIN);
  await poseWaste(h, cards(...WASTE), WASTE_SETS);

  const played = await h.debug.move(
    "waste",
    0,
    TOP_ROW,
    "foundation",
    FOUNDATION,
  );
  await h.advance(DRAW_FRAMES);
  await captureStill(h, "played");

  assertEqual(
    played,
    true,
    `move's verdict on the waste's ${SUIT} 2 offered to a ${SUIT} foundation ` +
      "holding its Ace, which specs/foundations.md accepts",
  );

  const after = await h.snapshot();
  assertDeepEqual(
    after.wasteSets,
    SETS_AFTER,
    "the waste's set memory after the play, oldest set first — " +
      "specs/stock.md: playing the top card leaves ITS set one card smaller, " +
      "and the set turned before it untouched",
  );
  assertEqual(
    after.wasteVisibleCount,
    SETS_AFTER[SETS_AFTER.length - 1],
    "the cards the waste is showing after the play — specs/stock.md: it " +
      "shows what is left on the newest set, which is one card fewer than it " +
      "was",
  );
  assertLength(
    after.waste,
    WASTE.length - 1,
    "the cards left on the waste — one card went home, so the pile is one " +
      "card shorter than it was",
  );
});
