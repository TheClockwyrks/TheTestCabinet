// Cascade — table/tableau-anchor-y: a column's first card has its top edge at
// `TABLEAU_Y`.
//
// specs/table.md, The columns: "Each column begins at `TABLEAU_Y` (`180`), at
// its own `COLUMN_X`", and "So a column's first card has its top edge at
// `y = 180`".
//
// THE READING IS y ALONE, and that is what all seven columns are posed for.
// Which x a column stands at is `column-anchors`' point, so this check never
// names one: it counts how many card-sized boxes below the top row were drawn
// with their top edge at `180`, and a build that put its columns at the right
// height passes wherever across the table it put them.
//
// Posing a card on EVERY column is what makes the count mean something. A column
// holding no cards draws its empty mark at the same anchor (specs/table.md,
// Empty piles), so a build that drew its cards at some other height, on a table
// where six columns were empty, would still leave six card-sized marks at `180`.
// With all seven columns holding a card there is no mark left to answer for
// them, and the seven boxes at the anchor can only be the seven first cards.
//
// The top row is excluded by the specification's own line — "The top row's
// rectangles end at `y = 164` and the columns' begin at `y = 180`" — so the six
// piles up there, and the marks they draw while empty, are never counted.
//
// AND THE READING IS BOTH WAYS ROUND. Counting boxes AT the anchor is not enough
// on its own: a build is free to spend more than one card-sized shape on a card
// — an outer plate and an inner panel — so a build that drew four of its seven
// columns at `180` with two shapes each and the other three somewhere else would
// still leave seven boxes at the anchor. So the check also reads that NO
// card-sized box below the top row sits away from `180`. With one card posed on
// each of the seven columns and every other pile empty, the only card-sized
// shapes down there belong to those seven cards, so the two readings together
// say every column's first card starts on the anchor and nothing of them starts
// anywhere else.

import { afterEach, beforeEach, it } from "vitest";
import {
  CARD_H,
  TABLEAU_COLUMNS,
  TABLEAU_Y,
  TOP_ROW_Y,
} from "../../src/constants";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import {
  alternatingRun,
  captureStill,
  COLUMNS,
  createHarness,
  KING,
  openTable,
  poseCard,
  type Harness,
} from "../harness";
import { cardBoxes, corners } from "./placed";

/**
 * How far a drawn box's size may sit from `100 x 140`, as a fraction of each
 * side, and still be READ as a card.
 *
 * This is identification and not a requirement: it is how a check picks the
 * cards out of a frame that also drew pips, ranks, the felt and the HUD strip,
 * and it is deliberately loose so that the ONE point about the footprint is the
 * one that decides it. A build that drew every card a few units small has its
 * geometry read here exactly like any other and is charged once, by `card-size`.
 * A fifth of each side is far wider than a defect of that kind and far narrower
 * than anything else this game puts on the table.
 */
const CARD_LIKE_TOLERANCE = 0.2;

/**
 * How far a first card's top edge may sit from `TABLEAU_Y` (`180`), in logical
 * units. The anchor is a whole number in a space that maps one-to-one onto the
 * canvas here, so a conformant build lands on it exactly; a build that used the
 * top row's `24`, or that left room for a heading, is tens of units away.
 */
const ANCHOR_TOLERANCE = 1;

/** Where the top row's own footprint ends (specs/table.md). */
const TOP_ROW_BOTTOM = TOP_ROW_Y + CARD_H;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts every posed column's first card at y = 180", async () => {
  openTable(h);
  const cards = alternatingRun(KING, TABLEAU_COLUMNS);
  COLUMNS.forEach((column) => poseCard(h, "tableau", column, cards[column]));

  const calls = await h.drawFrame();
  captureStill(h, "column");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);
  const tableau = boxes.filter((box) => box.y > TOP_ROW_BOTTOM);
  const atAnchor = tableau.filter(
    (box) => Math.abs(box.y - TABLEAU_Y) <= ANCHOR_TOLERANCE,
  );

  assertGreaterThanOrEqual(
    atAnchor.length,
    TABLEAU_COLUMNS,
    `the first card of each of the ${TABLEAU_COLUMNS} posed columns drawn ` +
      `with its top edge at y = ${TABLEAU_Y}; below the top row the frame ` +
      `drew card-sized boxes at ${corners(tableau)}`,
  );

  const offAnchor = tableau.filter(
    (box) => Math.abs(box.y - TABLEAU_Y) > ANCHOR_TOLERANCE,
  );
  assertDeepEqual(
    offAnchor.map((box) => Math.round(box.y)),
    [],
    `the top edges of the card-sized boxes drawn below the top row away from ` +
      `y = ${TABLEAU_Y}: every column holds exactly its first card, so nothing ` +
      "down there begins anywhere but on the anchor (specs/table.md)",
  );
});
