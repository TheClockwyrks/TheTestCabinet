// handling/press-grabs-waste-top — a press on the waste lifts its top card alone.
//
// THE RULE. specs/controls.md: a press on "the waste's top card" lifts "that card
// alone", and a press on "a card on the waste that is not its top card" lifts
// nothing. specs/stock.md: the waste's top card is the last of the cards it
// shows, and only that card may be played. The run enters the hand on the press
// itself, so `snapshot().drag` is read with no frame advanced and no motion
// (specs/controls.md, specs/instrumentation.md).
//
// THE WASTE IS TWO TURNS DEEP, POSED AT THE TURN COUNT THE BUILD REPORTS. Two
// sets of `TURN_COUNT` cards, which is the waste two turns of this build's stock
// leaves (specs/stock.md), so the pose is the same sentence under either deal
// mode and no variant's count is written into this common suite. The count comes
// off `snapshot().turnCount` rather than out of the build's own `src/constants`,
// which the build writes; `draw-one/deal-mode-reported` and
// `draw-three/deal-mode-reported` are what pin that reading to the specification.
// The pose separates the wrong models:
//
//   the top card alone (the rule)        ->  1 card
//   every card the waste SHOWS           ->  TURN_COUNT cards
//   every card the waste HOLDS           ->  2 * TURN_COUNT cards
//
// WHERE THE PRESS LANDS. `wasteTopPoint` is the point that lies on the waste's
// top card under EITHER deal mode: Draw One squares its shown card at the waste
// anchor and Draw Three fans up to three to the right of it, and specs/table.md
// caps the fan's right edge, so the two readings overlap on the top card. The
// waste's own anchor is NOT that point — under Draw Three it lies on an older
// fanned card, which lifts nothing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  poseWaste,
  pressAt,
  topOf,
  wasteTopPoint,
  type CardSpec,
  type Harness,
} from "../harness";

/**
 * The cards on the waste: two turns' worth, distinct so a failure names which
 * card the build put in the hand. Their suit and rank decide nothing here.
 */
function wasteOf(turnCount: number): CardSpec[] {
  return Array.from({ length: 2 * turnCount }, (_, i) => card("spades", i + 2));
}

/** The cards the hand must hold: the waste's top card, and nothing else. */
const HELD_COUNT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the waste's top card in the hand and leaves the rest of the waste", async () => {
  openTable(h);

  const turnCount = h.snapshot().turnCount;
  assertGreaterThan(turnCount, 0, "the turn count this build reports");
  const cards = wasteOf(turnCount);

  // The set memory those cards belong to: one set per turn (specs/stock.md).
  poseWaste(h, cards, [turnCount, turnCount]);
  const topId = topOf(h.snapshot().waste)?.id;

  const at = wasteTopPoint();
  pressAt(h, at.x, at.y);
  const held = h.snapshot();
  await h.advance(1);
  captureStill(h, "held");

  assertNotNull(
    held.drag,
    "the run in hand after a press on the waste's top card, which enters the " +
      "hand on the press itself (specs/controls.md)",
  );
  assertLength(
    held.drag?.cards ?? [],
    HELD_COUNT,
    `the cards in hand off a waste holding ${String(cards.length)} cards ` +
      `across two sets of ${String(turnCount)}: a press on the waste lifts ` +
      "its top card alone (specs/controls.md)",
  );
  assertEqual(
    held.drag?.cards[0]?.id,
    topId,
    "the id of the card in hand, which is the waste's top card — the last of " +
      "the cards it shows (specs/stock.md)",
  );
  assertEqual(
    held.drag?.fromPile,
    "waste",
    "the pile the card was lifted from (specs/instrumentation.md)",
  );
  assertEqual(
    held.drag?.fromIndex,
    0,
    "the waste's index, which is always 0 (specs/instrumentation.md)",
  );
});
