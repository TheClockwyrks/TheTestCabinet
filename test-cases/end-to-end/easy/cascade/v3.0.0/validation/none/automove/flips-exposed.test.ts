// automove/flips-exposed — sending a column's only face-up card home turns the
// card beneath it.
//
// `specs/controls.md`, on the gesture the auto-move serves: "Sending a card home
// this way is a move like any other, so it turns a newly exposed column card and
// it can win the game." `specs/instrumentation.md` puts `autoMove` among the
// operations that "route through exactly the code a player's gesture routes
// through", and `specs/tableau.md` fixes the turn itself: "When an accepted move
// leaves a column whose lowest card is face-down, that card is turned face-up.
// Only that one card turns."
//
// WHAT THIS CHECK ISOLATES. The column carries one face-down card under one
// face-up card, so exactly one turn is owed and the auto-move is the only thing
// that could owe it. The gate `specs/instrumentation.md` puts on that turning,
// `setAutoFlip`, is left ON at its reset default and asserted so, because the
// gate itself is `instrumentation/auto-flip-gate`'s to grade, not this item's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  cards,
  captureStill,
  createHarness,
  faceDown,
  openTable,
  pileOf,
  poseColumn,
  poseFoundation,
  topOf,
  whereIs,
  type Harness,
} from "../harness";

/** The spades foundation, holding the Ace alone. */
const SPADES_FOUNDATION = 1;

/** The column: one face-down card under the column's only face-up card. */
const COLUMN = 6;
const COVERED = "7C";
const SENT = "2S";

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the card the auto-move uncovers", async () => {
  await openTable(h);
  await poseFoundation(h, SPADES_FOUNDATION, "spades", 1);
  const [coveredId, sentId] = await poseColumn(h, COLUMN, [
    ...faceDown(COVERED),
    ...cards(SENT),
  ]);

  const posed = await h.snapshot();
  assertEqual(
    posed.autoFlip,
    true,
    "the automatic-flip gate this check leaves on",
  );
  assertEqual(
    posed.tableau[COLUMN][0].faceUp,
    false,
    "the face of the covered card before the auto-move",
  );

  const went = await h.debug.autoMove("tableau", COLUMN);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "flipped");

  assertEqual(went, true, "the verdict autoMove returned");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, sentId),
    { pile: "foundation", index: SPADES_FOUNDATION, row: 1 },
    "where the card that was sent ended up",
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    1,
    "the cards the column is left holding",
  );
  assertEqual(
    topOf(pileOf(after, "tableau", COLUMN))?.id,
    coveredId,
    "the card the column now shows lowest",
  );
  assertEqual(
    topOf(pileOf(after, "tableau", COLUMN))?.faceUp,
    true,
    "the face of the card the auto-move uncovered",
  );
});
