// handling/press-grabs-waste-top — a press on the waste lifts its top card, alone.
//
// specs/controls.md's grab table: a press on "the waste's top card" lifts "that card
// alone", and a press on "a card on the waste that is not its top card" lifts
// nothing. specs/stock.md says the same from the other side: "Only the waste's top
// card may be played." The run enters the hand on the press itself
// (specs/controls.md), so the gesture is one `pointerDown` and the reading is
// `snapshot().drag` immediately afterwards.
//
// THE WASTE HOLDS MORE THAN ONE CARD, which is what makes the item decidable: a
// build that treats the waste like a column and lifts "the card and every card below
// it" reads two cards where the rule owes one.
//
// THE SET MEMORY SHOWS ONE CARD, under either deal mode. specs/stock.md has the
// waste show "the cards it holds from the newest set that still holds any", and the
// sets are posed here rather than turned, so the pose is the same under Draw One and
// Draw Three: two sets of one card each, so the newest set holds the top card alone
// and the waste shows exactly it, drawn at the waste anchor whatever the deal mode
// fans (specs/table.md). Nothing about this pose depends on `TURN_COUNT`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseWaste,
  pressPoint,
  type Harness,
} from "../harness";

/** The waste, bottom card first, so the last of them is its top card. */
const WASTE_CARDS = ["3C", "9D"];

/** One set per card, so the newest set holds the top card and the waste shows it. */
const WASTE_SETS = [1, 1];

/** What the press owes the hand: the waste's top card, and nothing else. */
const EXPECTED_RUN = ["9D"];

/** What the waste keeps while that card is in hand. */
const EXPECTED_LEFT = ["3C"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lifts the waste's top card alone on a press over the waste", async () => {
  openTable(h);
  poseWaste(h, WASTE_CARDS, WASTE_SETS);

  const at = pressPoint(h.snapshot(), "waste", 0, WASTE_CARDS.length - 1);
  h.debug.pointerDown(at.x, at.y);
  const held = h.snapshot();
  await h.advance(1);
  captureStill(h, "held");

  assertDeepEqual(
    held.drag === null ? null : pileSpecs(held.drag.cards),
    EXPECTED_RUN,
    "the run in hand after a press on the waste: its top card alone, and not " +
      "the cards squared away beneath it (specs/controls.md, specs/stock.md)",
  );
  assertDeepEqual(
    held.drag === null ? null : held.drag.fromPile,
    "waste",
    "the pile the run in hand was lifted from (specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileSpecs(held.waste),
    EXPECTED_LEFT,
    "the cards left on the waste: the lifted card leaves the pile as it " +
      "enters the hand (specs/controls.md)",
  );
});
