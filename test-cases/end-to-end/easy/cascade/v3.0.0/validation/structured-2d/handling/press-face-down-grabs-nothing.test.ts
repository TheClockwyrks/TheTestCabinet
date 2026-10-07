// handling/press-face-down-grabs-nothing — a press on a face-down card lifts
// nothing.
//
// THE RULE. specs/controls.md: a press resolving to "a face-down card" lifts
// "Nothing". specs/tableau.md says the same from the other side: "A face-down
// card is never moved and is never read. It becomes playable only once it has
// been turned this way."
//
// THE FACE-DOWN CARD IS THE COLUMN'S LOWEST, WITH A FACE-UP CARD ABOVE IT.
// specs/controls.md resolves a press to "the lowest of the cards whose footprint
// contains that point", and a column's cards overlap, so the point this press
// lands on lies inside the face-up seven's footprint as well as the face-down
// six's. Two wrong builds are caught by that, and both leave a run in the hand
// where the rule leaves none:
//
//   one that lifts the card the press resolved to without asking its face;
//   one that resolves the press to the card drawn HIGHEST at the point and
//   carries the face-down card below it along, which specs/tableau.md forbids.
//
// A build that answers the press by walking UP to the nearest face-up card and
// finds it cannot take the face-down card with it lifts nothing either, and
// nothing is what this point requires.
//
// WHAT IS READ. `drag` stays null, and the column still holds both its cards with
// both faces as they were — the second reading because a build could clear `drag`
// and still have taken the cards off the pile, which specs/controls.md has a lift
// do the moment a run enters the hand.
//
// NO GATE IS TOUCHED. `setAutoFlip` gates the turning of a newly exposed card,
// which only an accepted MOVE does (specs/tableau.md); a press turns nothing, so
// the requirement is read against the gates as `reset` leaves them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  down,
  grabPoint,
  openTable,
  poseColumn,
  pressAt,
  SEVEN,
  SIX,
  type Harness,
} from "../harness";
import { pileText } from "./gestures";

/** The column in play. */
const COLUMN = 4;

/**
 * The column, bottom-most card first: a face-up seven with a face-down six below
 * it, so the card the press resolves to lies face-down.
 */
const CARDS = [card("spades", SEVEN), down(card("hearts", SIX))];

/** The row the press lands on: the column's lowest card, the face-down one. */
const GRAB_ROW = 1;

/** The column as it must still read after the press. */
const UNCHANGED = ["7S", "#6H"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the hand empty when the press resolves to a face-down card", async () => {
  openTable(h);
  poseColumn(h, COLUMN, CARDS);

  const at = grabPoint(h.snapshot(), COLUMN, GRAB_ROW);
  pressAt(h, at.x, at.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unheld");

  assertNull(
    after.drag,
    `the run in hand after a press on the face-down card at row ${GRAB_ROW} of ` +
      `column ${COLUMN}, which lifts nothing (specs/controls.md)`,
  );
  assertDeepEqual(
    pileText(after.tableau[COLUMN]),
    UNCHANGED,
    `column ${COLUMN} after the press: nothing was lifted, so nothing left the ` +
      "pile and no face changed (specs/controls.md, specs/tableau.md)",
  );
});
