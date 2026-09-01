// presentation/back-distinct-from-face — a card back reads apart from a card face.
//
// THE RULE. `specs/overview.md`'s legibility table, the row "A card back": "A
// face-down card reads apart from a face-up card and from the table behind it."
// Which of a column's cards are face-down is the whole of what a player can see
// about the work still to do — `specs/deal.md` deals twenty-one of them that way
// — so a back a player reads as a face is a table a player cannot read.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. The distance between a back and a
// face. The other half of the same row, a back against the table, is
// `presentation/back-distinct-from-table`, and a face against the table is
// `presentation/face-distinct-from-table`; each is its own point, so a build
// that gets one of the three wrong is docked once.
//
// IT IS ONE CARD, TURNED OVER. `setCardFaceUp` turns the card that is already
// posed, so the two frames compared are the same card at the same anchor on the
// same pile, and the only thing that differs between them is the face it shows.
// Two cards posed side by side would have compared two anchors as well as two
// faces.
//
// THE COLOUR OF EACH IS THE MEAN OF THE CARD'S INTERIOR, because what the row
// asks is whether the CARD reads apart at a glance rather than whether some
// pixel of it does. A back drawn as a pattern and a face drawn as ink on white
// each read as what they come to across the whole card, which is what a player
// sees.
//
// THE PALETTE IS THE BUILD'S: specs/overview.md fixes no colour, so nothing here
// knows a hex value and what is measured is the distance between the two things
// the build itself painted.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, and one card is
// put on column `0`. A column is where specs/deal.md puts a face-down card, and
// a column holding one card draws it at the tableau anchor with no fan offset in
// it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { COLUMN_X, TABLEAU_Y } from "../constants";
import {
  captureStill,
  cards,
  colorDistance,
  createHarness,
  faceDown,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { cardColor, showColor } from "./reading";

/** The card posed, face-down, and then turned over. */
const CARD = "7S";

/** The column it is posed on, and the anchor specs/table.md fixes for it. */
const COLUMN = 0;
const ANCHOR_X = COLUMN_X[COLUMN];
const ANCHOR_Y = TABLEAU_Y;

/** Where the evidence still puts a second card, beside the first. */
const BESIDE = 1;

/**
 * How far apart a back and a face must read, in RGB distance out of `441`.
 *
 * The review item's own figure. specs/overview.md requires a face-down card to
 * "read apart" from a face-up one and fixes no colour, so the bar is what a
 * measurement can honestly call two different things rather than two shades of
 * one: `90` is a fifth of the scale, about the distance from a mid grey to a
 * black. The `simple-2d` and `structured-2d` suites hold the same requirement to
 * the same figure.
 */
const APART_MIN = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a card back apart from a card face", async () => {
  await openTable(h);
  const [id] = await poseColumn(h, COLUMN, faceDown(CARD));

  await h.advance(1);
  const back = await cardColor(h, ANCHOR_X, ANCHOR_Y);

  await h.debug.setCardFaceUp(id, true);
  await h.advance(1);
  const face = await cardColor(h, ANCHOR_X, ANCHOR_Y);

  // The evidence, and nothing the readings above depend on: a back beside a
  // face, which is the picture the review item asks for.
  await h.debug.setCardFaceUp(id, false);
  await poseColumn(h, BESIDE, cards(CARD));
  await h.advance(1);
  await captureStill(h, "faces");

  assertGreaterThanOrEqual(
    colorDistance(back, face),
    APART_MIN,
    `the distance between the card drawn face-down, ${showColor(back)}, and ` +
      `the same card drawn face-up, ${showColor(face)}, out of 441 ` +
      "(specs/overview.md: a face-down card reads apart from a face-up card)",
  );
});
