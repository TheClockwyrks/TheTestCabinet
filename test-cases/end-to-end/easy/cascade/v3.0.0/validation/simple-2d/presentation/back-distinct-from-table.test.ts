// presentation/back-distinct-from-table — a card back reads apart from the table.
//
// THE RULE. specs/overview.md's legibility table, the row "A card back": "A
// face-down card reads apart from a face-up card and from the table behind it."
// This point is the second half of that row: a back against the felt it sits on.
// The first half is `presentation/back-distinct-from-face`, and the face against
// the felt is `presentation/face-distinct-from-table`.
//
// WHERE THE TABLE IS READ. specs/table.md fixes the seven columns at a pitch of
// `122` for a `100`-wide card and says of the `22` units between them that "The
// gaps between the columns carry no pile and nothing card-sized is drawn in
// them". The strip between column `0` and column `1` is therefore table and
// nothing else, and it is the table immediately beside the card this point poses
// on column `0` — which is what "the table behind it" means. Reading the build's
// exported `BACKGROUND` instead would have measured the colour the canvas is
// CLEARED to rather than what a player sees behind the card.
//
// EACH COLOUR IS A MEAN over its region, so a felt drawn as a texture or a
// gradient reads as what it comes to at a glance, and so does a back drawn as a
// lattice.
//
// THE PALETTE IS THE BUILD'S: specs/overview.md fixes no colour, so nothing here
// knows a hex value and what is measured is the distance between two things the
// build itself painted.
//
// THE WORLD IT POSES. `openTable` empties all thirteen piles, and one face-down
// card is put on column `0`. Column `1` is left empty, so the strip the table is
// read in has an empty pile on one side of it and the posed card on the other,
// and neither is inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { COLUMN_X, TABLEAU_Y } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawFrame,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { cardColor, tableColor } from "./reading";

/** The card posed, face-down, as specs/deal.md leaves a buried column card. */
const CARD = "#7S";

/** The column it is posed on, and the anchor specs/table.md fixes for it. */
const COLUMN = 0;
const ANCHOR_X = COLUMN_X[COLUMN];
const ANCHOR_Y = TABLEAU_Y;

/**
 * How far apart a back and the table must read, in RGB distance out of `441`.
 *
 * The review item's own figure. specs/overview.md requires a face-down card to
 * "read apart" from the table and fixes no colour, so the bar is what a
 * measurement can honestly call a card against a ground rather than one shade on
 * another: `60` is about a seventh of the scale. It sits below the `90` the same
 * table asks of a card FACE against the table, because a back is one field of
 * colour with no ink on it to carry the reading, and a build that draws a quiet
 * back on a quiet felt is still a build a player can play. The `none` and
 * `structured-2d` suites hold the same requirement to the same figure.
 */
const APART_MIN = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a card back apart from the table behind it", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [CARD]);
  await drawFrame(h);
  captureStill(h, "back");

  const back = cardColor(h, ANCHOR_X, ANCHOR_Y);
  const table = tableColor(h);

  assertGreaterThanOrEqual(
    colorDistance(back, table),
    APART_MIN,
    "the distance between the face-down card, " +
      `rgb(${back.r.toFixed(0)}, ${back.g.toFixed(0)}, ${back.b.toFixed(0)}), ` +
      "and the table beside it, " +
      `rgb(${table.r.toFixed(0)}, ${table.g.toFixed(0)}, ${table.b.toFixed(0)}), ` +
      "out of 441 (specs/overview.md: a face-down card reads apart from the " +
      "table behind it)",
  );
});
