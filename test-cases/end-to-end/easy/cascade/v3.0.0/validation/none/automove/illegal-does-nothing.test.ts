// automove/illegal-does-nothing — with no foundation able to accept the card,
// the auto-move answers `false` and leaves the board exactly as it was.
//
// `specs/instrumentation.md`: autoMove "sends the named pile's playable card to
// the foundation it belongs on when that is legal, and does nothing otherwise
// ... It returns ... `false` when nothing moved."
//
// THE DISTINGUISHING POSE. All four foundations are empty and the waste shows a
// KING. `specs/foundations.md` fixes what an empty foundation takes: "Nothing |
// An Ace, of any suit" — an Ace and nothing else. So a build that treats an
// empty foundation as a home for any card lands the King on one and reads as a
// different board here, rather than being averaged away. The rank rule against a
// STARTED foundation is the sibling `automove/obeys-rank`; this is the empty
// board's half of the same refusal.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  cards,
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseWaste,
  wasteTop,
  whereIs,
  type Harness,
} from "../harness";

/** The card offered. Not an Ace, so no empty foundation may take it. */
const OFFERED = "KH";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a card no foundation accepts and leaves the board alone", async () => {
  await openTable(h);
  const [offeredId] = await poseWaste(h, cards(OFFERED), [1]);

  assertEqual(
    wasteTop(await h.snapshot())?.id,
    offeredId,
    "the waste's top card before the auto-move",
  );

  const went = await h.debug.autoMove("waste", 0);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unchanged");

  assertEqual(went, false, "the verdict autoMove returned");

  const after = await h.snapshot();
  for (let i = 0; i < after.foundations.length; i += 1) {
    assertLength(
      pileOf(after, "foundation", i),
      0,
      `the cards on foundation ${i} after the refusal`,
    );
  }
  assertDeepEqual(
    whereIs(after, offeredId),
    { pile: "waste", index: 0, row: 0 },
    "where the refused card is",
  );
  assertLength(after.waste, 1, "the cards on the waste after the refusal");
  assertEqual(
    after.wasteVisibleCount,
    1,
    "the cards the waste is still showing",
  );
});
