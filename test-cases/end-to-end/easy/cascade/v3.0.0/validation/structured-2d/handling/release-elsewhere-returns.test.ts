// handling/release-elsewhere-returns — a release away from every pile puts the
// run back.
//
// THE RULE. specs/controls.md: a drop whose leading card's centre lies "In no
// pile's rectangle" has "The run returns to the pile it was lifted from", and
// specs/table.md fixes the thirteen rectangles: "A point in none of them lies on
// no pile."
//
// WHERE THE RUN IS RELEASED, AND WHY THERE. Directly BELOW a short column.
// specs/table.md gives "a column holding cards" a rectangle running "from
// `TABLEAU_Y` down to the bottom edge of that column's lowest drawn card", so a
// column of one card answers only as far as `y = 320` and the felt beneath it
// belongs to no pile at all. That is the tempting place, and it separates the
// readings the specification's figure exists to settle:
//
//   the rectangle specs/table.md fixes (the rule)  ->  no pile: the run returns
//   the column's whole drawn extent, or its band    ->  column 1 takes the run
//   the nearest column to the release               ->  column 1 takes the run
//
// The bystander column holds a BLACK SEVEN, so it would accept the red six this
// run is led by (specs/tableau.md) and a build reading its rectangle too
// generously lands the run there rather than merely refusing it — the difference
// is visible on the board rather than swallowed by a refusal.
//
// The check reads back that the release point really lies in none of the thirteen
// rectangles, computed from the table as it stands while the run is HELD, so the
// reading cannot pass by accident on a build that carried the run somewhere else.
//
// THE RUN IS TWO CARDS, deliberately, so "in the order it left"
// (specs/tableau.md) is a reading a one-card run could not make, and a build that
// returns a run reversed or beneath the cards left behind fails here.
//
// THIS IS NOT THE REFUSED-PILE CASE. `handling/release-on-illegal-returns`
// releases the run inside the rectangle of a pile that says no; this one releases
// it where there is no pile to ask.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_H, CARD_W, COLUMN_X } from "../../src/constants";
import { assertDeepEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  card,
  cardTopLeft,
  COLUMNS,
  createHarness,
  dropRectIn,
  FIVE,
  FOUNDATIONS,
  grabPoint,
  inRect,
  movePointerTo,
  openTable,
  poseColumn,
  pressAt,
  releaseAt,
  SEVEN,
  SIX,
  type Harness,
  type PileKind,
} from "../harness";
import { carryTo, pileText } from "./gestures";

/** The column the run is lifted from, and the column the release lands under. */
const FROM_COLUMN = 0;
const BELOW_COLUMN = 1;

/** The source column, bottom-most card first: a run of three by specs/tableau.md. */
const SOURCE = [
  card("spades", SEVEN),
  card("hearts", SIX),
  card("clubs", FIVE),
];

/** The row the press lands on: the red six, so the run in hand is two cards. */
const FROM_ROW = 1;

/** The bystander: a black seven, which would accept the run's red six. */
const BYSTANDER = [card("clubs", SEVEN)];

/**
 * The height the leading card's CENTRE is released at.
 *
 * A column of one card is drawn from `TABLEAU_Y` (`180`) and is `CARD_H` (`140`)
 * tall, so its drop rectangle ends at `y = 320` (specs/table.md). `400` is eighty
 * units below that line and well above the HUD strip at `680`, so it lies on the
 * bare felt beneath the column.
 */
const BELOW_Y = 400;

/** The two columns as they must read after the release. */
const RETURNED = ["7S", "6H", "5C"];
const UNTOUCHED = ["7C"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the run back in its source column when the release lands on no pile", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, SOURCE);
  poseColumn(h, BELOW_COLUMN, BYSTANDER);

  const posed = h.snapshot();
  const press = grabPoint(posed, FROM_COLUMN, FROM_ROW);
  const lead = cardTopLeft(posed, "tableau", FROM_COLUMN, FROM_ROW);
  // The centre of a card sits (CARD_W / 2, CARD_H / 2) inside its top-left
  // (specs/table.md), so this is the top-left that puts the centre on the felt
  // beneath the bystander column.
  const bare = { x: COLUMN_X[BELOW_COLUMN] + CARD_W / 2, y: BELOW_Y };
  const release = carryTo(press, lead, {
    x: bare.x - CARD_W / 2,
    y: bare.y - CARD_H / 2,
  });

  pressAt(h, press.x, press.y);
  movePointerTo(h, release.x, release.y);

  // The table AS IT STANDS WHILE THE RUN IS HELD is what fixes the thirteen
  // rectangles the release is resolved against, so the reading is taken here
  // rather than off the posed board: the source column has already lost the run.
  const held = h.snapshot();
  const holding: string[] = [];
  const check = (pile: PileKind, index: number): void => {
    if (inRect(dropRectIn(held, pile, index), bare.x, bare.y)) {
      holding.push(`${pile} ${String(index)}`);
    }
  };
  check("stock", 0);
  check("waste", 0);
  for (const index of FOUNDATIONS) check("foundation", index);
  for (const index of COLUMNS) check("tableau", index);

  releaseAt(h, release.x, release.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "returned");

  assertLength(
    holding,
    0,
    `the piles whose drop rectangle contains (${String(bare.x)}, ` +
      `${String(bare.y)}), the point the leading card's centre was released ` +
      "over, which lies on the felt below a one-card column (specs/table.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[FROM_COLUMN]),
    RETURNED,
    `column ${String(FROM_COLUMN)} after a release on no pile: every card the ` +
      "run carried is back in the order it left (specs/controls.md, " +
      "specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[BELOW_COLUMN]),
    UNTOUCHED,
    `column ${String(BELOW_COLUMN)}, the column the release landed BELOW: its ` +
      "drop rectangle ends at the bottom edge of its lowest card, so it is not " +
      "the pile the release resolved to (specs/table.md, specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the run in hand after the release, which ended the gesture " +
      "(specs/controls.md)",
  );
});
