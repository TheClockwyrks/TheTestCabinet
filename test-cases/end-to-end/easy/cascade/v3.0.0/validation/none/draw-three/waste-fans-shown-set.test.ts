// draw-three/waste-fans-shown-set — the shown set fans to the right of the anchor.
//
// THE RULE. `specs/table.md`: the cards the waste shows "are fanned to the right
// from the waste anchor at a pitch of `WASTE_FAN` (`26`), oldest first, so with
// three cards shown they are drawn with their top-left corners at `(346, 24)`,
// `(372, 24)`, and `(398, 24)`, and the last of them is the waste's top card".
//
// THE POSE. Three cards on the waste and one set holding all three, so the whole
// pile is shown and every card-sized shape the waste draws belongs to the fan.
// Nothing else is posed, so nothing else can put a card-sized shape in the top row
// between the two draw piles and the foundations.
//
// WHAT IS READ. Every card-sized shape the frame painted whose top-left lands in
// the top row, between a card's width left of the waste anchor and the first
// foundation's. Three readings come off it, and each names a different wrong
// build:
//
//   1. A card sits at each of the three positions. A build that squares the shown
//      set, or fans at the wrong pitch, or fans leftward, misses one or more.
//   2. Nothing card-sized sits anywhere else in that band. A build that fans four
//      cards, or begins the fan away from the anchor, draws a card the rule does
//      not account for.
//   3. The last of those shapes painted is the one at `398`. `specs/table.md`
//      fixes the pile's own order: "the top card of the stock, the waste, or a
//      foundation is the one drawn over the rest of that pile", and the fanned
//      cards overlap, so the top card is the last one painted. A build that fanned
//      the same three positions newest-first would put its playable card at `346`
//      and paint it under the two behind it.
//
// The waste anchor itself is `table.waste-anchor`, and the fan's clearance of its
// neighbours is `draw-three/fan-clear-of-neighbours`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertDeepEqual, assertTrue } from "../assert";
import { CARD_W, FOUNDATION_X, TOP_ROW_Y, WASTE_X } from "../constants";
import {
  cardFootprints,
  cards,
  captureStill,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";
import { fanCardX } from "./constants";

/** The three cards of the shown set, bottom first, so the last is the top card. */
const SHOWN = ["3S", "7H", "KD"];

/** One set, holding all three, so the waste shows every card it holds. */
const SETS = [SHOWN.length];

/**
 * Where the three shown cards are drawn: the waste anchor, and the pitch again
 * twice, which is `346`, `372` and `398` (`specs/table.md`).
 */
const FAN_X = SHOWN.map((_card, index) => fanCardX(index));

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
 * How far a painted shape's size may sit from the card footprint and still be read
 * as a card, in logical units.
 *
 * A card's footprint is fixed at `CARD_W x CARD_H` (`specs/table.md`) and
 * `table/card-size` is the point that grades it, so this is not a size tolerance:
 * it is room for the unit a build may lose insetting a stroke or rounding a
 * corner, and a shape that is not a card misses by tens of units.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far a card's corner may sit from a position and still be read as sitting at
 * it, in logical units.
 *
 * The same allowance for an inset stroke, applied to the corner rather than to the
 * size. The pitch this check reads is `26`, so nothing drawn at a wrong fan
 * position lands inside it.
 */
const PLACEMENT_TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the shown set at 346, 372 and 398, topmost last", async () => {
  await openTable(h);
  await poseWaste(h, cards(...SHOWN), SETS);

  const calls = await h.frameCalls();
  await captureStill(h, "fan");

  const fan = cardFootprints(calls, CARD_SIZE_TOLERANCE).filter(
    (corner) =>
      Math.abs(corner.y - TOP_ROW_Y) <= PLACEMENT_TOLERANCE &&
      corner.x >= BAND_LEFT &&
      corner.x < BAND_RIGHT,
  );

  for (const [index, x] of FAN_X.entries()) {
    assertTrue(
      fan.some((corner) => Math.abs(corner.x - x) <= PLACEMENT_TOLERANCE),
      `a card drawn at (${x}, ${TOP_ROW_Y}), which is card ${index + 1} of the ` +
        "shown set counted oldest first (specs/table.md)",
    );
  }

  const stray = fan.filter((corner) =>
    FAN_X.every((x) => Math.abs(corner.x - x) > PLACEMENT_TOLERANCE),
  );
  assertDeepEqual(
    stray.map((corner) => Math.round(corner.x)),
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
    "the left edge of the last card the waste drew: its top card sits at " +
      `${topmost} and is the one drawn over the rest of the pile ` +
      "(specs/table.md)",
  );
});
