// automove/from-empty-pile — an auto-move from an empty pile does nothing.
//
// specs/instrumentation.md: a pile that holds no playable card sends nothing, which
// covers an empty pile, and `autoMove` returns `false` when nothing moved.
//
// THE TABLE IS DELIBERATELY WINNABLE ELSEWHERE. The spades foundation is started and
// the two of spades waits in a DIFFERENT column, so a legal auto-move exists on the
// board. The call names the empty column instead. A build that ignores the pile it
// was given and sweeps the table for any card it could send home moves the two of
// spades and fails here; a build that reads the named pile finds it empty and sends
// nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  ACE,
  captureStill,
  card,
  createHarness,
  openTable,
  poseColumn,
  poseFoundation,
  TWO,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The started foundation and its suit. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_UP_TO = ACE;
/** The column the call names, which holds nothing. */
const EMPTY_COLUMN = 0;
/** Another column, holding a card that COULD go home. */
const STOCKED_COLUMN = 4;
const PLAYABLE = card(FOUNDATION_SUIT, TWO);
const PLAYABLE_TEXT = "2S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends nothing from an empty column and leaves the board as it was", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_UP_TO);
  poseColumn(h, STOCKED_COLUMN, [PLAYABLE]);
  const before = boardText(h.snapshot());

  const went = h.debug.autoMove("tableau", EMPTY_COLUMN);
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "unchanged");

  assertEqual(
    went,
    false,
    `autoMove("tableau", ${EMPTY_COLUMN}), a column holding no card at all ` +
      "(specs/instrumentation.md)",
  );
  assertDeepEqual(
    after,
    before,
    `the board after the call: ${PLAYABLE_TEXT} is still in column ` +
      `${STOCKED_COLUMN}, because the call named the empty one ` +
      "(specs/instrumentation.md)",
  );
});
