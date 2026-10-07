// instrumentation/move-refuses-illegal — a move the rules refuse returns `false`
// and leaves the board exactly as it was.
//
// THE RULE. specs/instrumentation.md: `move` "returns ... `false` when they
// refused it", and "A refused move leaves the board unchanged."
//
// WHY IT IS A `broken` POINT, AND WHY THE TWO VERDICTS ARE TWO POINTS. A build
// whose `move` always answers `false` is a different defect from one that always
// answers `true`, and every suite that poses a board with `move` stands on one
// direction or the other. `instrumentation/move-accepts-legal` is the other half.
//
// THE MOVE IS ONE THE TABLE REFUSES OUTRIGHT: a King onto an EMPTY foundation,
// which specs/foundations.md refuses whatever else is on the board — an empty
// foundation takes an Ace and nothing else — so no ordering, colour or run rule
// is in play and the verdict is the whole of what is read.
//
// THE REFUSAL IS READ ON THE WHOLE BOARD. Every one of the thirteen piles is
// printed — ids, suits, ranks and faces — immediately before the refused move and
// compared afterwards, so a build that answers `false` and then quietly applies
// the move, or that half-applies it by lifting the King and dropping it back
// somewhere else, fails on the pile that changed.
//
// WHAT THIS DOES NOT DECIDE. The rules themselves, which are `foundations/*`'s,
// `tableau/*`'s and `runs/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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

const REFUSED_CARD = "QS";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
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
  // Before the assertions, so a move that applied anyway still leaves the
  // picture of the board it changed.
  captureStill(h, "board");

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
