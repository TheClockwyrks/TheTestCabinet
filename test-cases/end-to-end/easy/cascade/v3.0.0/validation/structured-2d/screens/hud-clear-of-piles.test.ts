// screens/hud-clear-of-piles — the HUD sits in its strip, and no card reaches it.
//
// specs/table.md: "The band `STAGE_W` wide at `y = HUD_Y` (`680`), `HUD_H` (`36`)
// tall, is the HUD strip. It carries the three controls and the deal-mode label
// `specs/screens.md` defines, and it holds no pile. `COLUMN_BOTTOM_LIMIT` keeps
// every column clear of it." specs/screens.md says it from the HUD's side: the
// strip is where the HUD lives, "so it never overlaps a pile". A control a card
// is drawn over is a control a player cannot press.
//
// THE TWO HALVES ARE THE ONE REQUIREMENT: the HUD and the table do not share
// ground.
//
//   THE CONTROLS. The three rectangles specs/controls.md fixes are read from this
// project's own `constants.ts`, which transcribes them, and each must lie
// inside the strip. A build that put a control outside the band has moved the
// HUD onto the table, whatever its own module says the rectangle is.
//
//   THE CARDS. The longest column the game can ever produce is posed, and every
//   card-sized box the frame drew must end above the strip. specs/table.md keeps
//   it there by compressing the column's face-up offset until its lowest card's
//   bottom edge sits at or above `COLUMN_BOTTOM_LIMIT` (`676`), four units clear
//   of `HUD_Y`.
//
// NINETEEN CARDS IS THAT LONGEST COLUMN. A deal leaves column `6` holding seven
// cards, six of them face-down (specs/deal.md), and the most that can then be
// built onto its face-up card is a King-to-Ace run of thirteen
// (specs/tableau.md). Six face-down and thirteen face-up is what is posed, and it
// is the case a build's compression has to survive: at the uncompressed offsets
// the column would reach `y = 872`, deep inside the strip.
//
// WHAT THIS DOES NOT DECIDE. That the compression lands on `676` exactly, that it
// is uniform, and that it stops at `FACE_UP_OFFSET_MIN`, are the `table` group's
// (`column-compression`, `compression-uniform`, `compression-floor`); that each
// HUD label is drawn inside its own rectangle is `presentation/hud-labels-drawn`.
// This point reads the clearance between the two.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  CARD_H,
  CARD_W,
  HUD_H,
  HUD_MENU,
  HUD_NEW_GAME,
  HUD_SOUND,
  HUD_Y,
  STAGE_W,
  type Rect,
} from "../constants";
import {
  alternatingRun,
  card,
  captureStill,
  createHarness,
  down,
  drawnImages,
  drawnShapes,
  KING,
  openTable,
  poseColumn,
  type CardSpec,
  type Harness,
} from "../harness";

/**
 * How far a drawn box's size may sit from the figures specs/table.md fixes, in
 * logical units.
 *
 * A card's footprint is exactly `CARD_W x CARD_H` wherever it sits, so this is
 * not a size tolerance: it is room for the unit a build may lose insetting a
 * stroke or rounding a corner. It is applied to the SIZE alone; the bottom edge
 * below is held to the strip's own line, because a card that reaches the strip
 * reaches it by tens of units.
 */
const CARD_BOX_TOLERANCE = 2;

/** The strip specs/table.md fixes, which the HUD has to itself. */
const STRIP: Rect = { x: 0, y: HUD_Y, w: STAGE_W, h: HUD_H };

/** The column the longest run is posed on, and the shape of that column. */
const COLUMN = 6;

/** The six face-down cards a deal leaves under column `6`'s face-up card. */
const BURIED: readonly CardSpec[] = [2, 3, 4, 5, 6, 7].map((rank) =>
  down(card("clubs", rank)),
);

/** The King-to-Ace run built on top of them: the longest a column can hold. */
const RUN: readonly CardSpec[] = alternatingRun(KING, 13, "spades");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps its three controls in the strip and the longest column out of it", async () => {
  // The controls, as this build carries them.
  for (const [name, rect] of [
    ["HUD_NEW_GAME", HUD_NEW_GAME],
    ["HUD_MENU", HUD_MENU],
    ["HUD_SOUND", HUD_SOUND],
  ] as const) {
    assertGreaterThanOrEqual(
      rect.y,
      STRIP.y,
      `the top edge of ${name}, which lies in the HUD strip (specs/table.md)`,
    );
    assertLessThanOrEqual(
      rect.y + rect.h,
      STRIP.y + STRIP.h,
      `the bottom edge of ${name}, which lies in the HUD strip ` +
        "(specs/table.md)",
    );
    assertGreaterThanOrEqual(
      rect.x,
      STRIP.x,
      `the left edge of ${name}, which lies in the HUD strip (specs/table.md)`,
    );
    assertLessThanOrEqual(
      rect.x + rect.w,
      STRIP.x + STRIP.w,
      `the right edge of ${name}, which lies in the HUD strip ` +
        "(specs/table.md)",
    );
  }

  // The cards, on the longest column the game can produce.
  openTable(h);
  poseColumn(h, COLUMN, [...BURIED, ...RUN]);
  const posed = h.snapshot();
  assertEqual(
    posed.tableau[COLUMN].length,
    BURIED.length + RUN.length,
    `posing: cards on column ${COLUMN}, the longest a game can produce ` +
      "(specs/deal.md, specs/tableau.md)",
  );

  const calls = await h.drawFrame();
  captureStill(h, "strip");

  const boxes = [...drawnShapes(h, calls), ...drawnImages(h, calls)].filter(
    (box) =>
      Math.abs(box.w - CARD_W) <= CARD_BOX_TOLERANCE &&
      Math.abs(box.h - CARD_H) <= CARD_BOX_TOLERANCE,
  );
  assertGreaterThanOrEqual(
    boxes.length,
    posed.tableau[COLUMN].length,
    "card-sized boxes the frame drew, one at least for each card of the " +
      "posed column, so the reading below is of a table that was drawn " +
      "(specs/table.md)",
  );

  const lowest = boxes.reduce(
    (deepest, box) => Math.max(deepest, box.y + box.h),
    0,
  );
  assertLessThanOrEqual(
    lowest,
    STRIP.y,
    "the bottom edge of the lowest card the frame drew, which stays above " +
      `the HUD strip at y = ${STRIP.y} (specs/table.md)`,
  );
});
