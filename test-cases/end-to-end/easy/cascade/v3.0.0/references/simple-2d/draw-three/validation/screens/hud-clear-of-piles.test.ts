// screens/hud-clear-of-piles — the HUD has a strip of its own, and no card comes
// into it.
//
// THE RULE. specs/table.md: "The band `STAGE_W` wide at `y = HUD_Y` (`680`),
// `HUD_H` (`36`) tall, is the HUD strip. It carries the three controls and the
// deal-mode label specs/screens.md defines, and it holds no pile.
// `COLUMN_BOTTOM_LIMIT` keeps every column clear of it." specs/screens.md says the
// same from the HUD's side: the HUD "occupies the strip specs/table.md fixes along
// the bottom of the table, so it never overlaps a pile".
//
// THE FIRST READING is that the three control rectangles specs/controls.md fixes
// lie inside that band. Those are the case's own figures rather than the build's,
// and restating them here is what makes the second reading mean what this point
// claims: a card that has come into the strip is a card lying over a control the
// player has to be able to press.
//
// THE SECOND READING IS THE ONE THE BUILD ANSWERS. A column of nineteen cards is
// posed — six face-down, as column six is dealt (specs/deal.md), under a full King
// to Ace run, which is the longest a column can grow to — and the frame is read for
// any card-sized box reaching into the strip. At the natural offsets specs/table.md
// fixes that column's lowest card would have its bottom edge at
// `180 + 6x24 + 12x34 + 140` = `872`, which is `156` units past the bottom of the
// strip, so a build that never compresses puts cards squarely over all three
// controls and is caught here. A build that keeps its columns above
// `COLUMN_BOTTOM_LIMIT` (`676`) leaves `4` units of clear table between the lowest
// card and `HUD_Y` (`680`).
//
// WHAT THIS DOES NOT DECIDE. How a long column compresses — that its lowest edge
// sits at or above `676`, that the reduction is uniform, that it never falls below
// `14`, that it spares the face-down offset, and that it relaxes again — which are
// `table/column-compression` and its four neighbours. This point reads the strip,
// not the column: a build could satisfy every one of those points and still draw
// something card-sized into the HUD's band.

import { afterEach, beforeEach, it } from "vitest";
import {
  HUD_H,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  HUD_Y,
  STAGE_W,
  type Rect,
} from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  cardBoxes,
  captureStill,
  createHarness,
  drawFrame,
  drawnBoxes,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The HUD strip specs/table.md fixes: `STAGE_W` wide at `HUD_Y`, `HUD_H` tall. */
const STRIP: Rect = { x: 0, y: HUD_Y, w: STAGE_W, h: HUD_H };

/** The three controls the strip carries (specs/screens.md, specs/controls.md). */
const CONTROLS: readonly { name: string; rect: Rect }[] = [
  { name: "HUD_NEW_GAME", rect: HUD_NEW_GAME },
  { name: "HUD_MENU", rect: HUD_MENU },
  { name: "HUD_SOUND", rect: HUD_SOUND },
];

/**
 * The column posed: the longest a column of this game ever grows to.
 *
 * Six face-down cards, which is what column six is dealt beneath its one face-up
 * card (specs/deal.md), under a full King-to-Ace run built down in rank and
 * alternating in colour (specs/tableau.md). Nineteen cards in all, which at the
 * natural offsets would reach `872` — `156` units past the bottom of the strip.
 */
const LONG_COLUMN = [
  "#2C",
  "#3C",
  "#4C",
  "#5C",
  "#6C",
  "#7C",
  "KS",
  "QH",
  "JS",
  "10H",
  "9S",
  "8H",
  "7S",
  "6H",
  "5S",
  "4H",
  "3S",
  "2H",
  "AS",
];

/** The column it is posed on: the one dealt six face-down cards. */
const COLUMN = 6;

/**
 * How far a drawn box may sit from the card footprint and still be read as a card,
 * in logical units.
 *
 * A card's footprint is `CARD_W x CARD_H` (specs/table.md), so this is not a size
 * tolerance: it is room for a build that insets or outsets its outline, and the
 * HUD's own drawing — a strip `1280 x 36` and its three controls, none of them
 * within `10` units of `100 x 140` — cannot be mistaken for a card at this width.
 */
const CARD_LIKE = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every card out of the strip its three controls sit in", async () => {
  for (const control of CONTROLS) {
    assertEqual(
      control.rect.x >= STRIP.x &&
        control.rect.x + control.rect.w <= STRIP.x + STRIP.w &&
        control.rect.y >= STRIP.y &&
        control.rect.y + control.rect.h <= STRIP.y + STRIP.h,
      true,
      `${control.name} lying inside the HUD strip, the band ${STRIP.w} wide ` +
        `at y = ${STRIP.y}, ${STRIP.h} tall (specs/table.md, ` +
        "specs/controls.md)",
    );
  }

  openTable(h);
  poseColumn(h, COLUMN, LONG_COLUMN);
  assertLength(
    h.snapshot().tableau[COLUMN],
    LONG_COLUMN.length,
    `posing: cards on column ${COLUMN}, whose natural extent would reach ` +
      "872 and pass right through the strip (specs/table.md)",
  );

  const calls = await drawFrame(h);
  captureStill(h, "strip");

  const drawn = cardBoxes(drawnBoxes(h, calls), CARD_LIKE);
  assertGreaterThanOrEqual(
    drawn.length,
    LONG_COLUMN.length,
    "card-sized boxes the frame drew, one at least for each card of the " +
      "posed column — so the reading below is taken off a table that was " +
      "DRAWN, rather than passing because the build drew nothing at all " +
      "(specs/screens.md)",
  );

  const intruders = drawn.filter(
    (box) =>
      box.y + box.h > STRIP.y &&
      box.y < STRIP.y + STRIP.h &&
      box.x + box.w > STRIP.x &&
      box.x < STRIP.x + STRIP.w,
  );
  assertLength(
    intruders,
    0,
    `card-sized boxes the frame drew reaching into the HUD strip, y ` +
      `${STRIP.y} to ${STRIP.y + STRIP.h}, with the longest column on the ` +
      "table (specs/table.md: the strip holds no pile; specs/screens.md: the " +
      "HUD never overlaps a pile)",
  );
});
