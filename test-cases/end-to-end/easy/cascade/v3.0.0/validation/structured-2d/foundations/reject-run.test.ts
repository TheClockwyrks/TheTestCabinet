// foundations/reject-run — a foundation takes one card at a time, so a run is
// refused.
//
// specs/foundations.md: "A foundation takes exactly one card at a time. A run of two
// or more cards is refused, even when its leading card alone would be accepted."
// specs/tableau.md: a move out of a column takes the named card and every card below
// it, and a run is led by its highest card.
// specs/instrumentation.md: `fromRow` is the grabbed card's index within its pile;
// the grabbed card and every card the pile holds after it move together as a run. A
// refused move returns `false` and leaves the board unchanged.
//
// THE POSE IS THE SPEC'S OWN EDGE CASE. The spade foundation holds its Ace, and a
// column holds the 2 of spades with the Ace of hearts fanned below it — a legal
// two-card run, descending and alternating in color, whose LEADING card is exactly
// the card that foundation would accept on its own. The move grabs the leading card,
// so both travel. A build that tests only the leading card against the foundation
// accepts the pair and fails here; a build that counts the cards first refuses it.
//
// `build-up-same-suit` and `suit-locked-after-ace` are what say the leading card
// alone would have gone, so a build that refuses everything is not passing this by
// accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  alternatingRun,
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  TWO,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The foundation the run is offered to, its suit, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_TOP_RANK = ACE;
/** The column the run waits in. */
const COLUMN = 3;
/**
 * The two-card run, the leading card first: descending in rank and alternating in
 * color, as specs/tableau.md defines a run. Its leading card is the 2 of the
 * foundation's own suit — the one card that foundation would accept alone.
 */
const RUN = alternatingRun(TWO, 2, FOUNDATION_SUIT);
const RUN_TEXT = "2S over AH";
/** The grabbed card's row: the run's leading card, at the top of the column. */
const GRAB_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a two-card run whose leading card alone would be accepted", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, RUN);
  const before = boardText(h.snapshot());

  const accepted = h.debug.move(
    "tableau",
    COLUMN,
    GRAB_ROW,
    "foundation",
    FOUNDATION,
  );
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move of the run ${RUN_TEXT} onto a foundation holding the Ace of ` +
      `${FOUNDATION_SUIT}: a foundation takes exactly one card at a time ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: both cards are still in the column, " +
      "in the order they lay there, and the foundation still holds its Ace " +
      "alone (specs/instrumentation.md)",
  );
});
