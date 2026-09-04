// automove/from-empty-pile — an auto-move named on an empty pile answers `false`
// and leaves the board alone.
//
// `specs/instrumentation.md`: "A pile that holds no playable card sends nothing,
// which covers an empty pile, a column whose lowest card is face-down, and a
// foundation ... It returns ... `false` when nothing moved."
//
// THE POSE IS WHAT MAKES THE ANSWER MEAN SOMETHING. A card that WOULD go home is
// sitting in another column, with its foundation started and waiting for it. So a
// build that answers the question "is there a card to send?" instead of "does
// THIS pile hold one?" finds that card, sends it, and reads as a different board
// — rather than passing because an empty table had nothing to move either way.
// The face-down and foundation halves of the same sentence are
// `automove/face-down-does-nothing` and `automove/foundation-source-does-nothing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  cards,
  captureStill,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  whereIs,
  type Harness,
} from "../harness";

/** The empty column the call names. */
const EMPTY_COLUMN = 5;

/** The spades foundation, holding the Ace, and the two of spades it is owed. */
const SPADES_FOUNDATION = 0;
const BYSTANDER_COLUMN = 2;
const BYSTANDER = "2S";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sends nothing when the named pile is empty", async () => {
  await openTable(h);
  await poseFoundation(h, SPADES_FOUNDATION, "spades", 1);
  const [bystanderId] = await poseColumn(h, BYSTANDER_COLUMN, cards(BYSTANDER));

  assertLength(
    pileOf(await h.snapshot(), "tableau", EMPTY_COLUMN),
    0,
    "the cards in the column the call names",
  );

  const went = await h.debug.autoMove("tableau", EMPTY_COLUMN);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "unchanged");

  assertEqual(went, false, "the verdict autoMove returned");

  const after = await h.snapshot();
  assertLength(
    pileOf(after, "tableau", EMPTY_COLUMN),
    0,
    "the cards the empty column holds after the call",
  );
  assertDeepEqual(
    whereIs(after, bystanderId),
    { pile: "tableau", index: BYSTANDER_COLUMN, row: 0 },
    "where the card that could have gone home still is",
  );
  assertLength(
    pileOf(after, "foundation", SPADES_FOUNDATION),
    1,
    "the cards on the spades foundation after the call",
  );
});
