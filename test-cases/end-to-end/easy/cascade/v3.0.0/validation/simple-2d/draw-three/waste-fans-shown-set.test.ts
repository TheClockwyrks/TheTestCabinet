// draw-three/waste-fans-shown-set — the shown set fans to the right of the anchor.
//
// THE RULE. specs/table.md: the cards the waste shows "are fanned to the right from
// the waste anchor at a pitch of `WASTE_FAN` (`26`), oldest first, so with three
// cards shown they are drawn with their top-left corners at `(346, 24)`,
// `(372, 24)`, and `(398, 24)`, and the last of them is the waste's top card".
//
// THE POSE. Three cards on the waste and one set holding all three, so the whole
// pile is shown and every card-sized shape the waste draws belongs to the fan.
// Nothing else is posed, so nothing else can put a card-sized shape in the top row
// between the two draw piles and the foundations.
//
// WHAT IS READ. Every card-sized box the frame drew whose top-left lands in the top
// row, between the stock's own anchor and the first foundation's. Three readings
// come off it, and each names a different wrong build:
//
//   1. A box sits at each of the three positions. A build that squares the shown
//      set, or fans at the wrong pitch, or fans leftward, misses one or more.
//   2. Nothing card-sized sits anywhere else in that band. A build that fans four
//      cards, or begins the fan away from the anchor, draws a box the rule does not
//      account for.
//   3. The last of those boxes drawn is the one at `398`. specs/table.md fixes the
//      pile's own order: "the top card of the stock, the waste, or a foundation is
//      the one drawn over the rest of that pile", and the fanned cards overlap, so
//      the top card is the last one painted. A build that fanned the same three
//      positions newest-first would put its playable card at `346` and paint it
//      under the two behind it.
//
// The waste anchor itself is `table.waste-anchor`, and the fan's clearance of its
// neighbours is `draw-three/fan-clear-of-neighbours`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertDeepEqual, assertNotNull } from "../assert";
import { CARD_W, FOUNDATION_X, TOP_ROW_Y, WASTE_X } from "../constants";
import {
  boxAt,
  captureStill,
  CARD_BOX_TOLERANCE,
  cardBoxes,
  createHarness,
  drawFrame,
  DrawnBox,
  drawnBoxes,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";
import { WASTE_FAN } from "./constants";

/** The three cards of the shown set, bottom first, so the last is the top card. */
const SHOWN = ["3S", "7H", "KD"];

/** One set, holding all three, so the waste shows every card it holds. */
const SETS = [SHOWN.length];

/**
 * The pitch specs/table.md fans the shown set at, and where the three shown cards
 * are drawn: the waste anchor, and the pitch again twice, which is `346`, `372`
 * and `398`.
 *
 * The pitch is Draw Three's own figure, so it lives in this variant's own
 * `constants.ts` rather than in the project's, which is common to both deal
 * modes. Stated as the anchor plus the pitch, which is how the specification
 * states it, so the three literals it names are reproduced rather than restated.
 */
const FAN_X = SHOWN.map((_card, index) => WASTE_X + index * WASTE_FAN);

/**
 * The band the fan is read in: the top row, from a card's width left of the waste
 * anchor to the first foundation's anchor.
 *
 * It reaches left of the anchor so a fan drawn the wrong way is read rather than
 * missed, and stops at `FOUNDATION_X[0]`, which no card of the waste may reach
 * (`draw-three/fan-clear-of-neighbours`). The stock's own anchor, `224`, lies
 * outside it, so the empty-slot mark the stock draws is not mistaken for a card of
 * the fan.
 */
const BAND_LEFT = WASTE_X - CARD_W;
const BAND_RIGHT = FOUNDATION_X[0];

/**
 * How far a drawn box's corner may sit from a position and still be read as sitting
 * at it, in logical units. The harness's own allowance for the unit a build loses
 * insetting a stroke; the pitch this check reads is `26`, so nothing at a wrong
 * position lands inside it.
 */
const PLACEMENT_TOLERANCE = CARD_BOX_TOLERANCE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the shown set at 346, 372 and 398, topmost last", async () => {
  openTable(h);
  poseWaste(h, SHOWN, SETS);

  const calls = await drawFrame(h);
  captureStill(h, "fan");

  const fan: DrawnBox[] = cardBoxes(drawnBoxes(h, calls)).filter(
    (box) =>
      Math.abs(box.y - TOP_ROW_Y) <= PLACEMENT_TOLERANCE &&
      box.x >= BAND_LEFT &&
      box.x < BAND_RIGHT,
  );

  for (const [index, x] of FAN_X.entries()) {
    assertNotNull(
      boxAt(fan, x, TOP_ROW_Y, PLACEMENT_TOLERANCE),
      `a card drawn at (${x}, ${TOP_ROW_Y}), which is card ${index + 1} of the ` +
        "shown set counted oldest first (specs/table.md)",
    );
  }

  const stray = fan.filter((box) =>
    FAN_X.every((x) => Math.abs(box.x - x) > PLACEMENT_TOLERANCE),
  );
  assertDeepEqual(
    stray.map((box) => Math.round(box.x)),
    [],
    "the left edges of the card-sized shapes the waste drew away from the " +
      `three fan positions ${FAN_X.join(", ")} (specs/table.md)`,
  );

  const topmost = FAN_X[FAN_X.length - 1];
  const lastDrawn = fan.length === 0 ? Number.NaN : fan[fan.length - 1].x;
  assertBetween(
    lastDrawn,
    topmost - PLACEMENT_TOLERANCE,
    topmost + PLACEMENT_TOLERANCE,
    `the left edge of the last card the waste drew: its top card sits at ` +
      `${topmost} and is the one drawn over the rest of the pile ` +
      "(specs/table.md)",
  );
});
