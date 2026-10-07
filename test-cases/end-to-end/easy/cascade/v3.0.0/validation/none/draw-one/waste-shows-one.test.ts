// draw-one/waste-shows-one — three turns leave a waste that SHOWS one card. The
// set memory reports `1`, and the cards turned before it are squared away at the
// waste anchor rather than fanned beside it.
//
// `specs/stock.md` fixes the rule: "Each turn appends one set, holding exactly
// the cards that turn moved. The waste shows the cards it holds from the newest
// set that still holds any", and `specs/instrumentation.md` fixes the reading:
// "`wasteVisibleCount` | The newest entry of `wasteSets`". Under a turn count of
// `1` every set holds one card, so the waste shows one. `specs/table.md` fixes
// where they are drawn for this variant: "The card the waste shows … is drawn
// with its top-left at the waste anchor, and every other card the waste holds is
// squared away beneath it."
//
// WHAT THE DRAWN HALF IS FOR. The count alone would pass a build that reported
// `1` and fanned three cards across the table anyway, which is the Draw Three
// layout wired to the Draw One deal — the single most likely way to get this
// variant wrong. So the check reads the card-sized shapes the frame painted
// between the waste anchor and the first foundation and requires every one of
// them at the anchor: a fan at the sibling variant's pitch of `26` would paint
// them at `372` and `398` and land here.
//
// IT DOES NOT REQUIRE THREE SHAPES. A card squared exactly beneath another is
// invisible, and `specs/table.md` never says a hidden card must be painted, so a
// build that draws only the card it shows is conformant and passes. What is
// graded is that nothing is drawn ANYWHERE ELSE in the waste's stretch of the top
// row. Where the anchor itself is, is `table/waste-anchor`; how many cards three
// turns move, is `draw-one/turn-count`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { FOUNDATION_X, TOP_ROW_Y, WASTE_X } from "../constants";
import {
  captureStill,
  cardFootprints,
  cards,
  createHarness,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { TURN_COUNT } from "./constants";

/**
 * The stock the three turns are taken from, bottom card first.
 *
 * Four cards for three turns, so the last turn is taken from a stock that still
 * holds a card and no recycle is anywhere near this scenario
 * (`stock/empty-stock-recycles` is where that rule is decided).
 */
const STOCK = ["2C", "5H", "9S", "4D"] as const;

/** Turns made before the reading. Three, as the review item states. */
const TURNS = 3;

/**
 * Slack on a card's PAINTED SIZE, in logical units.
 *
 * `specs/table.md` fixes the footprint at `100 x 140` and `table/card-size`
 * grades that figure exactly. Here the size is only how a card is TOLD APART
 * from the HUD's plates and a pile's slot mark, so two units keeps a build that
 * insets or outlines its plate visible to a reading that is about position.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * Slack on a drawn card's left edge, in logical units.
 *
 * `specs/table.md` fixes the waste anchor at `x = 346` exactly. The smallest
 * displacement any wrong model produces is a fan, whose pitch the sibling variant
 * fixes at `26`, so one unit admits a build that seats its plate a hair off its
 * anchor and nothing this check means to catch.
 */
const ANCHOR_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shows one card, with the earlier turns squared beneath it", async () => {
  await openTable(h);
  await poseStock(h, cards(...STOCK));
  for (let turn = 0; turn < TURNS; turn += 1) await h.debug.turnStock();

  const calls = await h.frameCalls();
  await captureStill(h, "waste");

  const after = await h.snapshot();
  assertEqual(
    after.waste.length,
    TURNS * TURN_COUNT,
    "the cards three turns left on the waste",
  );
  assertEqual(
    after.wasteVisibleCount,
    TURN_COUNT,
    "the cards the waste shows after three turns",
  );

  // The waste's own stretch of the top row: from its anchor up to the first
  // foundation. The stock sits left of it, at 224, and is not read here.
  const drawn = cardFootprints(calls, CARD_SIZE_TOLERANCE)
    .filter(
      (p) =>
        Math.abs(p.y - TOP_ROW_Y) <= ANCHOR_TOLERANCE &&
        p.x >= WASTE_X - ANCHOR_TOLERANCE &&
        p.x < FOUNDATION_X[0] - ANCHOR_TOLERANCE,
    )
    .sort((a, b) => a.x - b.x);

  assertGreaterThanOrEqual(
    drawn.length,
    1,
    "card-sized shapes drawn in the waste's stretch of the top row",
  );
  for (const [index, p] of drawn.entries()) {
    assertBetween(
      p.x,
      WASTE_X - ANCHOR_TOLERANCE,
      WASTE_X + ANCHOR_TOLERANCE,
      `the left edge of card-sized shape ${index + 1} of ${drawn.length} on the waste`,
    );
  }
});
