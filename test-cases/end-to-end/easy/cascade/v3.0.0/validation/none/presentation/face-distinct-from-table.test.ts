// presentation/face-distinct-from-table — a card face reads apart from the table.
//
// THE RULE. `specs/overview.md`'s legibility table, the row "The table": "A card
// of either face reads apart from the table it sits on." This point is that row
// for a face-UP card; the face-down half of it is
// `presentation/back-distinct-from-table`, and a back against a face is
// `presentation/back-distinct-from-face`.
//
// WHERE THE TABLE IS READ. `specs/table.md` fixes the seven columns at a pitch
// of `122` for a `100`-wide card and says of the `22` units between them that
// "The gaps between the columns carry no pile and nothing card-sized is drawn in
// them". The strip between column `0` and column `1` is therefore table and
// nothing else, and it is the table immediately beside the card this point poses
// on column `0` — which is what "the table it sits on" means. An engineless
// build exports no background colour to ask instead, and asking one would have
// measured the colour the canvas is cleared to rather than what a player sees
// behind the card.
//
// EACH COLOUR IS A MEAN over its region, so a felt drawn as a texture or a
// gradient reads as what it comes to at a glance, and so does a face carrying
// its rank and its suit.
//
// THE PALETTE IS THE BUILD'S: specs/overview.md fixes no colour, so nothing here
// knows a hex value and what is measured is the distance between two things the
// build itself painted.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, and one face-up
// card is put on column `0`. Column `1` is left empty, so the strip the table is
// read in has an empty pile on one side of it and the posed card on the other,
// and neither is inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { COLUMN_X, TABLEAU_Y } from "../constants";
import {
  captureStill,
  cards,
  colorDistance,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { cardColor, showColor, tableColor } from "./reading";

/** The card posed, face-up, as a column's lowest card is dealt. */
const CARD = "7S";

/** The column it is posed on, and the anchor specs/table.md fixes for it. */
const COLUMN = 0;
const ANCHOR_X = COLUMN_X[COLUMN];
const ANCHOR_Y = TABLEAU_Y;

/**
 * How far apart a face and the table must read, in RGB distance out of `441`.
 *
 * The review item's own figure. specs/overview.md requires a card to "read
 * apart" from the table and fixes no colour, so the bar is what a measurement
 * can honestly call a card against a ground rather than one shade on another:
 * `90` is a fifth of the scale, about the distance from a mid grey to a black.
 * It is set above the `60` asked of a card BACK against the table because a face
 * is the surface a player reads a rank and a suit off, and it is read against
 * the felt every time the eye crosses the table. The `simple-2d` and
 * `structured-2d` suites hold the same requirement to the same figure.
 */
const APART_MIN = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws a card face apart from the table it sits on", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, cards(CARD));
  await h.advance(1);
  await captureStill(h, "face");

  const face = await cardColor(h, ANCHOR_X, ANCHOR_Y);
  const table = await tableColor(h);

  assertGreaterThanOrEqual(
    colorDistance(face, table),
    APART_MIN,
    `the distance between the face-up card, ${showColor(face)}, and the table ` +
      `beside it, ${showColor(table)}, out of 441 (specs/overview.md: a card ` +
      "of either face reads apart from the table it sits on)",
  );
});
