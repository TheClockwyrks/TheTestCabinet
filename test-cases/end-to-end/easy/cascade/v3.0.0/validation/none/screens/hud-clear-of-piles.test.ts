// screens/hud-clear-of-piles — the HUD strip holds no pile: no tableau card is
// drawn inside it, even by the deepest column a game can produce.
//
// `specs/table.md`, "The HUD strip": "The band `STAGE_W` wide at `y = HUD_Y`
// (`680`), `HUD_H` (`36`) tall, is the HUD strip. It carries the three controls
// and the deal-mode label `specs/screens.md` defines, and it holds no pile.
// `COLUMN_BOTTOM_LIMIT` keeps every column clear of it." `specs/screens.md` says
// the same from the other side: "The HUD occupies the strip `specs/table.md`
// fixes along the bottom of the table, so it never overlaps a pile."
//
// THE POSE IS THE DEEPEST COLUMN A GAME CAN REACH. `specs/deal.md` leaves a
// column with at most six face-down cards under its exposed card, and
// `specs/tableau.md` lets a run of at most thirteen face-up cards, King down to
// Ace, be stacked on it — so nineteen cards is the worst case, and it is the case
// the compression rule was written for. At the natural `FACE_UP_OFFSET` (`34`)
// that column would run its lowest card's bottom edge to `y = 932`, two hundred
// units into the strip and off the bottom of the stage; compressed as
// `specs/table.md` requires, it seats exactly on `COLUMN_BOTTOM_LIMIT` (`676`),
// four units clear. A build that never compresses, or that compresses to the
// wrong offset, draws cards inside the strip and fails here. All seven columns
// are posed alike, so a build that compresses six of them and not the seventh is
// caught and the failure names the column.
//
// WHAT IT DOES NOT DECIDE, and where the line is. `table/column-compression`,
// `table/compression-floor`, `table/compression-uniform` and
// `table/compression-spares-face-down` grade the compression rule itself, against
// `COLUMN_BOTTOM_LIMIT` and with no slack. This item asks the one question
// `specs/table.md` asks about the STRIP — whether a card entered it — so it
// measures against `HUD_Y` (`680`) rather than against `676`. The four units
// between the two figures are the specification's own margin, and a build that
// spends them has already failed the compression items and not this one.
//
// THE FIRST CLAUSE IS THE OTHER HALF OF THE SAME RULE, and it is a grade.
// `specs/controls.md`: "The HUD's three regions lie inside the HUD strip
// `specs/table.md` fixes, which holds no pile, so a press over the table during
// play is never a press on a control." WHERE those regions are is the build's
// own, so they are read back through `menuItemRect` and held against the strip:
// a build that hung a control over the table has taken a press away from the
// cards under it, which is the same fault from the other side.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  CARD_H,
  HUD_H,
  HUD_ITEMS,
  HUD_Y,
  RANK_MAX,
  STAGE_W,
  TABLEAU_COLUMNS,
  type Rect,
} from "../constants";
import {
  card,
  captureStill,
  columnRowTops,
  createHarness,
  menuRect,
  faceDown,
  openTable,
  poseColumn,
  runDown,
  type Harness,
} from "../harness";

/**
 * How far a shape's measured size may sit from `CARD_W x CARD_H`, and its left
 * edge from the column's anchor, and still be read as that column's card.
 *
 * `specs/table.md` fixes both figures exactly and `table/card-size` and
 * `table/column-anchors` hold a build to them with no slack. Two units is only
 * how a card is RECOGNIZED here; the columns are `122` apart, so it cannot let
 * one column answer for another.
 */
const READ_TOLERANCE = 2;

/** The six face-down cards `specs/deal.md` leaves under column 6's exposed card. */
const BURIED = faceDown("2S", "3H", "4S", "5H", "6S", "7H");

/** The longest face-up run `specs/tableau.md` allows: King down to Ace. */
const RUN = runDown(card("KS"), RANK_MAX);

/** The HUD strip itself (`specs/table.md`). */
const STRIP: Rect = { x: 0, y: HUD_Y, w: STAGE_W, h: HUD_H };

/**
 * How many cards each posed column must actually have been drawn as.
 *
 * The whole column, not one card of it. What is read below is the bottom edge of
 * a column's LOWEST drawn card, so a build that drew the top card of each column
 * and clipped the rest — which is exactly the fault that leaves a player unable to
 * see the cards this rule is about — would have a "lowest" card high on the table
 * and pass a floor of one. Requiring the posed count makes the lowest drawn card
 * really be the column's lowest card before its foot is held against the strip.
 * Both engine suites require the whole column the same way.
 */
const POSED_ROWS = BURIED.length + RUN.length;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the deepest columns out of the HUD strip", async () => {
  await openTable(h);

  // The three regions the build itself reports for the HUD's menu, in the order
  // `HUD_ITEMS` fixes.
  for (const [index, name] of HUD_ITEMS.entries()) {
    const rect = await menuRect(h, index);
    assertGreaterThanOrEqual(
      rect.y,
      STRIP.y,
      `the top edge of ${name} against the strip's (specs/table.md)`,
    );
    assertLessThanOrEqual(
      rect.y + rect.h,
      STRIP.y + STRIP.h,
      `the bottom edge of ${name} against the strip's (specs/table.md)`,
    );
    assertGreaterThanOrEqual(
      rect.x,
      STRIP.x,
      `the left edge of ${name} against the strip's (specs/table.md)`,
    );
    assertLessThanOrEqual(
      rect.x + rect.w,
      STRIP.x + STRIP.w,
      `the right edge of ${name} against the strip's (specs/table.md)`,
    );
  }

  for (let col = 0; col < TABLEAU_COLUMNS; col += 1) {
    await poseColumn(h, col, [...BURIED, ...RUN]);
  }

  const calls = await h.frameCalls();
  await captureStill(h, "strip");

  for (let col = 0; col < TABLEAU_COLUMNS; col += 1) {
    const rows = columnRowTops(calls, col, READ_TOLERANCE);
    assertGreaterThanOrEqual(
      rows.length,
      POSED_ROWS,
      `the rows column ${col} drew a card on, against the ${POSED_ROWS} cards posed on it — every one of them is drawn, so the lowest below really is the column's lowest card (specs/table.md)`,
    );
    const lowest = rows[rows.length - 1];
    assertLessThanOrEqual(
      lowest + CARD_H,
      STRIP.y,
      `the bottom edge of column ${col}'s lowest drawn card against the top of the HUD strip (specs/table.md)`,
    );
  }
});
