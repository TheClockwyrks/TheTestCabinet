// automove/foundation-source-does-nothing — an auto-move named on a foundation
// sends nothing, because the card is already home.
//
// `specs/instrumentation.md`: "The playable card is the waste's top card, or a
// column's lowest face-up card. A pile that holds no playable card sends
// nothing, which covers ... a foundation ... It returns ... `false` when nothing
// moved." `specs/controls.md` fixes the same list for the gesture: "A playable
// card is the waste's top card or a column's lowest face-up card."
//
// THE POSE IS THE ONE THAT SEPARATES THE TWO MODELS. The foundation named holds
// the Ace of spades and nothing else, and the other three foundations are empty.
// A build that treats a foundation's top card as playable finds a legal
// destination for that Ace — `specs/foundations.md` lets an Ace start any empty
// foundation — and shuffles it to another slot. A build that reads the list
// above leaves all four foundations exactly as they were.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseFoundation,
  whereIs,
  type Harness,
} from "../harness";
import { FOUNDATION_COUNT } from "../constants";

/** The foundation the call names, holding the Ace of spades alone. */
const FOUNDATION = 0;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sends nothing from a foundation, whose card is already home", async () => {
  await openTable(h);
  const [aceId] = await poseFoundation(h, FOUNDATION, "spades", 1);

  const went = await h.debug.autoMove("foundation", FOUNDATION);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unchanged");

  assertEqual(went, false, "the verdict autoMove returned");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, aceId),
    { pile: "foundation", index: FOUNDATION, row: 0 },
    "where the Ace still sits",
  );
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    assertLength(
      pileOf(after, "foundation", i),
      i === FOUNDATION ? 1 : 0,
      `the cards on foundation ${i} after the call`,
    );
  }
});
