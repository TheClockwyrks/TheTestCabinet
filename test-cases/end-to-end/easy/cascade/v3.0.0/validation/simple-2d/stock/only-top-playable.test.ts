// stock/only-top-playable — a card buried on the waste may not be played.
//
// THE RULE. specs/stock.md: "Only the waste's top card may be played ... A move
// naming any other card on the waste is refused." The waste is a stack, and the
// cards under its top one are out of reach until the cards above them have gone.
//
// THE BURIED CARD IS ONE THE TARGET WOULD OTHERWISE TAKE. It is an Ace, and the
// foundation it is offered to is empty, so specs/foundations.md would accept it on
// sight; the only thing standing between it and that foundation is its position on
// the waste. That is what makes the refusal decide this rule and not another: a
// build that answers a move by looking only at the card named, and never at where it
// lies, accepts here and fails, while a build that refuses because it read the
// foundation wrongly fails `foundations/ace-starts-empty` instead.
//
// THE BOARD IS READ BACK AS WELL AS THE VERDICT, because specs/tableau.md's refusal
// rule is that "a refused move changes nothing": a build that returned `false` and
// moved the card anyway has refused nothing. The Ace has to still be on the waste,
// in its place, with the set memory as it was, and the foundation still empty.
//
// THE FRONTMOST CARD OF A FANNED SET is a separate rule and a separate point:
// `draw-three.only-frontmost-playable` decides the two cards behind the frontmost
// one of a shown fan. What is decided here is a card buried under an older set,
// which both deal modes reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

/**
 * The waste the refused move names into: an Ace buried under one later card, each
 * on a set of its own. The Ace is the bottom card, so it is neither the waste's top
 * card nor a card on the set the waste is showing.
 */
const POSED_WASTE = ["AS", "9D"] as const;
const POSED_SETS = [1, 1] as const;

/** The row the buried Ace sits at, counted from the bottom of the waste. */
const ACE_ROW = 0;

/** The foundation it is offered to: empty, so an Ace is what it accepts. */
const FOUNDATION = 0;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("refuses a move naming a card below the waste's top card", async () => {
  openTable(harness);
  const ids = poseWaste(harness, POSED_WASTE, POSED_SETS);

  const accepted = harness.debug.move(
    "waste",
    0,
    ACE_ROW,
    "foundation",
    FOUNDATION,
  );

  await harness.advance(1);
  captureStill(harness, "refused");

  assertEqual(
    accepted,
    false,
    "move() to refuse a waste card that is not the waste's top card " +
      "(specs/stock.md)",
  );

  const after = harness.snapshot();
  assertDeepEqual(
    after.waste.map((card) => card.id),
    ids,
    "the ids on the waste, bottom first, after the refused move, which changes " +
      "nothing (specs/tableau.md)",
  );
  assertDeepEqual(
    after.wasteSets,
    [...POSED_SETS],
    "the waste's set memory after the refused move (specs/tableau.md)",
  );
  assertLength(
    after.foundations[FOUNDATION],
    0,
    `cards on foundation ${FOUNDATION} after the refused move (specs/tableau.md)`,
  );
});
