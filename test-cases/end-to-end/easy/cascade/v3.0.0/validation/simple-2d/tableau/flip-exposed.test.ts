// tableau/flip-exposed — the card a move uncovers is turned face-up.
//
// specs/tableau.md: "when an accepted move leaves a column whose lowest card is
// face-down, that card is turned face-up."
// specs/instrumentation.md: an accepted `move` applies through the same path a
// released drop uses, "so a newly exposed column card turns".
//
// THE SMALLEST COLUMN THE RULE NEEDS: one face-down card with the column's only
// face-up card below it, and a target column that accepts that face-up card. The
// move therefore leaves the face-down card lowest, which is exactly the condition the
// rule names, and nothing else on the table can produce the turn.
//
// WHAT IS READ is the one card's face, found by the id it was posed with rather than
// by its place, so the verdict is the turn itself and not the column's shape. The
// move's own verdict is read first: a build that refused the move never reached the
// rule this item is about, and the failure says so rather than blaming the turn.
//
// THE GATE IS LEFT ON. `autoFlip` is on after `reset` and the automatic turn IS this
// item's requirement, so nothing here touches it; `setAutoFlip` is for the checks
// that need the faculty held still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  cardOf,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the move empties of face-up cards. */
const SOURCE = 1;
/** Its cards, top of the column first: one buried card and the card that leaves. */
const BURIED = "#7C";
const LEAVES = "9H";
/** The column that takes the departing card, and the card it lands on. */
const TARGET = 5;
const TARGET_LOWEST = "10S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the card the accepted move left lowest", async () => {
  openTable(h);
  const [buriedId] = poseColumn(h, SOURCE, [BURIED, LEAVES]);
  poseColumn(h, TARGET, [TARGET_LOWEST]);

  const accepted = h.debug.move("tableau", SOURCE, 1, "tableau", TARGET);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "flipped");

  assertEqual(
    accepted,
    true,
    `move of ${LEAVES} onto ${TARGET_LOWEST} in column ${TARGET}: one rank ` +
      "lower and the other color (specs/tableau.md)",
  );
  assertEqual(
    cardOf(after, buriedId).faceUp,
    true,
    `the face of ${BURIED}, the card the accepted move left lowest in ` +
      `column ${SOURCE} (specs/tableau.md: it is turned face-up)`,
  );
});
