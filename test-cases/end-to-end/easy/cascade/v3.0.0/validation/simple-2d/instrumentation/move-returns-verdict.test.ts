// instrumentation/move-returns-verdict — `move` reports what the game's own rules
// decided.
//
// specs/instrumentation.md: `move` "returns `true` when the game's own rules
// accepted the move and `false` when they refused it. An accepted move applies
// through the same path a released drop uses [...] A refused move leaves the board
// unchanged."
//
// WHY THE SUITE RESTS ON IT. `move` is how every rules check in this project asks
// the game a question, and the answer is the verdict it returns. A build that
// returned nothing, or that returned `true` for everything, would make every one of
// those checks read a constant.
//
// TWO CHECKS, because the two failures are different builds: one that always
// answers `true` passes the accepted direction and fails the refused one, and one
// that always answers `false` fails the first. Reading both is what tells them
// apart, and neither is asserted on the value alone: the accepted move must have
// APPLIED and the refused one must have left the board exactly as it stood.
//
// THE TWO SCENARIOS DIFFER IN ONE CARD. specs/tableau.md: a column whose lowest
// card is a black King accepts a run led by a red Queen and refuses one led by a
// black Queen. So the accepted move offers the Queen of hearts and the refused one
// the Queen of spades, onto the same King of clubs, from the same column, by the
// same call. Nothing else about the board changes, so what the two readings differ
// by is the rule and not the arrangement.
//
// WHETHER THAT RULE IS THE RIGHT ONE is `tableau.accepts-alternating-run`'s point.
// What is read here is that the verdict `move` hands back is the one the build's
// own rules reached, and that the board followed it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileOf,
  pileSpecs,
  poseColumn,
  type Harness,
} from "../harness";
import { assertOtherPilesUnchanged } from "./board";

/** The column the King of clubs waits on, and the column the Queen is offered from. */
const TARGET_COLUMN = 0;
const TARGET_CARD = "KC";
const SOURCE_COLUMN = 1;

/** The two Queens: the red one a black King accepts, the black one it refuses. */
const ACCEPTED_CARD = "QH";
const REFUSED_CARD = "QS";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns true for a legal move and applies it", async () => {
  openTable(h);
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);
  poseColumn(h, SOURCE_COLUMN, [ACCEPTED_CARD]);

  const accepted = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    0,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();

  // The board after the accepted move.
  await h.advance(1);
  captureStill(h, "board");

  assertEqual(
    accepted,
    true,
    `move must return true for the ${ACCEPTED_CARD} onto the ${TARGET_CARD}, ` +
      "which the column accepts (specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(pileOf(after, "tableau", TARGET_COLUMN)),
    [TARGET_CARD, ACCEPTED_CARD],
    `tableau ${TARGET_COLUMN}, bottom card first, once the accepted move has ` +
      "applied (specs/instrumentation.md)",
  );
  assertLength(
    pileOf(after, "tableau", SOURCE_COLUMN),
    0,
    `tableau ${SOURCE_COLUMN}, which the moved card has left`,
  );
});

it("returns false for an illegal move and leaves the board as it was", async () => {
  openTable(h);
  poseColumn(h, TARGET_COLUMN, [TARGET_CARD]);
  poseColumn(h, SOURCE_COLUMN, [REFUSED_CARD]);

  const before = h.snapshot();

  const accepted = h.debug.move(
    "tableau",
    SOURCE_COLUMN,
    0,
    "tableau",
    TARGET_COLUMN,
  );
  const after = h.snapshot();

  await h.advance(1);

  assertEqual(
    accepted,
    false,
    `move must return false for the ${REFUSED_CARD} onto the ${TARGET_CARD}, ` +
      "which the column refuses: a run lands only on a card of the other " +
      "color (specs/tableau.md)",
  );
  assertDeepEqual(
    pileSpecs(pileOf(after, "tableau", TARGET_COLUMN)),
    [TARGET_CARD],
    `tableau ${TARGET_COLUMN}, which the refused move left as it was ` +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    pileSpecs(pileOf(after, "tableau", SOURCE_COLUMN)),
    [REFUSED_CARD],
    `tableau ${SOURCE_COLUMN}, which keeps the card the refused move carried ` +
      "(specs/tableau.md)",
  );
  assertOtherPilesUnchanged(
    before,
    after,
    null,
    "a refused move leaves the board unchanged (specs/instrumentation.md)",
  );
});
