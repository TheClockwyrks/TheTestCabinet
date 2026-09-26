// instrumentation/card-ids-stable — a card keeps its id across a move.
//
// specs/instrumentation.md "Identity", second rule: "A card keeps its id for as
// long as it is on the table, across every move, turn, flip, and recycle." An id
// that is reassigned when a card changes piles turns every reading a check takes
// after a move into a reading of some other card, so the whole of this suite's
// ability to follow one card rests on it.
//
// THE SMALLEST MOVE THE RULE NEEDS. One card alone on a column, sent to an empty
// foundation, which specs/foundations.md accepts because it is an Ace. Nothing else
// is on the table, so there is no other card the id could have been read off and no
// other foundation the Ace could have gone to, and the card is followed by
// `placeOf`, which searches every pile: a build that moved the card and gave it a
// new number reports the id nowhere at all, and one that left a copy behind is
// caught by the column being empty.
//
// WHETHER THE MOVE IS LEGAL is `foundations.accepts-ace`'s point and
// `instrumentation.move-accepts-legal`'s; what this one reads is the id the card
// carries once the move the game accepted has applied.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  cardSpec,
  createHarness,
  openTable,
  pileOf,
  placeOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The one card on the table, the column it starts on, and where it is sent. */
const CARD = "AS";
const COLUMN = 4;
const FOUNDATION = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the moved card with the id it carried before the move", async () => {
  openTable(h);
  const id = poseColumn(h, COLUMN, [CARD])[0];

  const accepted = h.debug.move("tableau", COLUMN, 0, "foundation", FOUNDATION);
  const after = h.snapshot();

  // The card on its foundation, carrying the id it left with.
  await h.advance(1);
  captureStill(h, "moved");

  assertEqual(
    accepted,
    true,
    `move must apply ${CARD} onto empty foundation ${FOUNDATION}, which ` +
      "accepts an Ace of any suit (specs/foundations.md)",
  );

  const place = placeOf(after, id);
  assertEqual(
    place === null ? null : place.pile,
    "foundation",
    `the pile holding the card that left tableau ${COLUMN} with id ${id}: a ` +
      "card keeps its id across a move (specs/instrumentation.md)",
  );
  assertEqual(
    place === null ? null : place.index,
    FOUNDATION,
    `the foundation holding the card with id ${id}`,
  );
  assertEqual(
    place === null ? null : cardSpec(place.card),
    CARD,
    `the card the id ${id} names once the move has applied`,
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    0,
    `tableau ${COLUMN}, which the moved card has left`,
  );
});
