// tableau/no-flip-when-face-up — a move that leaves a face-up card lowest turns
// nothing.
//
// specs/tableau.md: the turn happens when an accepted move leaves a column whose
// lowest card is FACE-DOWN, and "a move that leaves a face-up card lowest turns
// nothing".
//
// THE POSE. A column of three: a buried card, a face-up nine, and the face-up eight
// below it. The move takes the eight alone, so the column's new lowest card is the
// nine, which is already face-up, and the buried card is still covered. A build
// whose turning rule fires on every accepted move out of a column, rather than on the
// condition the spec names, turns the buried card here and is caught; a build that
// turns the whole column is caught the same way.
//
// WHAT IS READ is every face in the source column, against the faces it was posed
// with. The cards themselves are read too, so a build that turned the buried card by
// moving cards about instead is not mistaken for one that left them alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the move leaves a face-up card lowest in. */
const SOURCE = 1;
/** Its cards, top of the column first: one buried card and a two-card run. */
const SOURCE_CARDS = ["#4D", "9H", "8S"];
/** What the column holds after the eight has left it. */
const SOURCE_AFTER = ["#4D", "9H"];
/** The column that takes the departing eight, and the card it lands on. */
const TARGET = 5;
const TARGET_LOWEST = "9D";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("changes no card's face when the move leaves a face-up card lowest", async () => {
  openTable(h);
  poseColumn(h, SOURCE, SOURCE_CARDS);
  poseColumn(h, TARGET, [TARGET_LOWEST]);

  const accepted = h.debug.move("tableau", SOURCE, 2, "tableau", TARGET);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertEqual(
    accepted,
    true,
    `move of ${SOURCE_CARDS[2]} onto ${TARGET_LOWEST} in column ${TARGET}: ` +
      "one rank lower and the other color (specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[SOURCE]),
    SOURCE_AFTER,
    `column ${SOURCE} after the move: the nine is lowest and face-up already, ` +
      "so the buried card above it is still face-down (specs/tableau.md)",
  );
});
