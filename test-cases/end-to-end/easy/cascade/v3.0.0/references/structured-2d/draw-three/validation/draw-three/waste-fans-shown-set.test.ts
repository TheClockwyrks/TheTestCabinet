// Cascade — draw-three/waste-fans-shown-set: the cards the waste shows fan to the right.
//
// specs/table.md, The waste: "The cards the waste shows ... are fanned to the
// right from the waste anchor at a pitch of `WASTE_FAN` (`26`), oldest first, so
// with three cards shown they are drawn with their top-left corners at
// `(346, 24)`, `(372, 24)`, and `(398, 24)`, and the last of them is the waste's
// top card. ... Every other card the waste holds is squared away at the waste
// anchor beneath them."
//
// Two halves, both stated there and both read from one frame:
//
//   THE THREE POSITIONS. A card-sized footprint is drawn at each of the three
//   corners the specification names. The pitch is `26` and the tolerance below is
//   two units, so no wrong pitch lands on a right answer: a build fanning at the
//   card's own width draws its second card at `446`, one fanning at half the
//   pitch draws it at `359`, and one that squared the shown set draws nothing at
//   `372` or `398` at all.
//
//   WHICH END THE TOP CARD IS AT. "Oldest first" and "the last of them is the
//   waste's top card" mean the card at `398` is the one drawn over its two
//   neighbours — specs/table.md, The order of a pile: a pile's top card "is the
//   one drawn over the rest of that pile", and the fan's cards overlap by
//   seventy-four units, so on a canvas that is a statement about paint order. A
//   build that fanned newest-first draws the same three footprints and is caught
//   here and nowhere else.
//
// The waste is posed with FIVE cards under two sets — an older set of two and a
// newer set of three — so what is checked is the SHOWN SET rather than the waste.
// A build that fanned every card it holds draws its fourth and fifth at `424` and
// `450`, which is not the arrangement asserted here; a build that fanned only the
// shown set draws the two older ones squared at the anchor, which is.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { CARD_H, CARD_W, TOP_ROW_Y, WASTE_X } from "../../src/constants";
import {
  ACE,
  FIVE,
  NINE,
  QUEEN,
  captureStill,
  card,
  createHarness,
  drawnShapes,
  openTable,
  poseWaste,
  type DrawnShape,
  type Harness,
} from "../harness";

/**
 * The pitch specs/table.md fans the shown set at, and the three corners it puts
 * three shown cards at: `346`, `372` and `398`.
 *
 * Stated as the anchor plus the pitch, which is how the specification states it,
 * so the three literals it names are reproduced rather than restated.
 */
const WASTE_FAN = 26;
const FAN_X = [0, 1, 2].map((position) => WASTE_X + position * WASTE_FAN);

/**
 * How far a drawn card's top-left may sit from the corner the specification puts
 * it at, in logical units.
 *
 * The specification fixes the corner exactly; this absorbs a build that insets a
 * border or a face by a unit and no more. It is well under the `26` pitch, so a
 * card drawn at one fan position is never read as sitting at another.
 */
const ANCHOR_TOLERANCE = 2;

/**
 * How far a drawn footprint may differ from the `CARD_W x CARD_H` specs/table.md
 * fixes for a card, in logical units.
 *
 * Two units, for the same reason: it lets a bordered card read as a card and
 * keeps the pips, corner marks and empty-slot decorations a build draws inside
 * one out of the reading.
 */
const SIZE_TOLERANCE = 2;

/**
 * The cards on the waste, bottom first, and the sets they belong to, oldest
 * first.
 *
 * Two buried under an older set of two, then three under the newest set — the
 * full fan, with cards behind it that must not join it.
 */
const WASTE = [
  card("clubs", FIVE),
  card("spades", NINE),
  card("spades", ACE),
  card("hearts", QUEEN),
  card("diamonds", ACE),
];
const SETS = [2, 3];

/** The shapes among `shapes` whose footprint is a card's. */
function cardShapes(shapes: readonly DrawnShape[]): DrawnShape[] {
  return shapes.filter(
    (shape) =>
      Math.abs(shape.w - CARD_W) <= SIZE_TOLERANCE &&
      Math.abs(shape.h - CARD_H) <= SIZE_TOLERANCE,
  );
}

/** How many of them were painted at a top-row corner, and where the last one was. */
function paintedAt(
  shapes: readonly DrawnShape[],
  x: number,
): { count: number; last: number } {
  let count = 0;
  let last = -1;
  shapes.forEach((shape, index) => {
    if (
      Math.abs(shape.x - x) <= ANCHOR_TOLERANCE &&
      Math.abs(shape.y - TOP_ROW_Y) <= ANCHOR_TOLERANCE
    ) {
      count += 1;
      last = index;
    }
  });
  return { count, last };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fans the three shown cards at 346, 372 and 398, the top card last", async () => {
  openTable(h);
  poseWaste(h, WASTE, SETS);

  const calls = await h.drawFrame();
  captureStill(h, "fan");

  const cards = cardShapes(drawnShapes(h, calls));
  const fan = FAN_X.map((x) => paintedAt(cards, x));

  FAN_X.forEach((x, position) => {
    assertGreaterThanOrEqual(
      fan[position].count,
      1,
      `a card drawn at (${x}, ${TOP_ROW_Y}), the shown set's card ${position + 1}`,
    );
  });

  // Oldest first, so the top card is the one at the right end of the fan — and
  // the fan's cards overlap, so being the card "drawn over the rest of the pile"
  // is being the last of the three painted.
  assertGreaterThan(
    fan[2].last,
    fan[1].last,
    `the card at ${FAN_X[2]} painted over the card at ${FAN_X[1]}`,
  );
  assertGreaterThan(
    fan[1].last,
    fan[0].last,
    `the card at ${FAN_X[1]} painted over the card at ${FAN_X[0]}`,
  );
});
