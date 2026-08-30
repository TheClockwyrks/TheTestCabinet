// handling/release-without-press — a release with nothing held changes nothing.
//
// specs/controls.md: "A release with nothing in hand and no control or stock under
// its press changes nothing." A gesture runs from a press to the release that
// follows it, so a release that follows no press has no gesture to end and no run to
// resolve.
//
// WHERE THE RELEASE LANDS. Over a column that WOULD accept the run standing beside
// it: the black six is the lowest card of the target column and the red five waits
// in another, which is exactly the pairing specs/tableau.md has a column accept and
// exactly the drop `handling/release-on-legal-completes` completes. So a build that
// resolves a release against the piles whether or not anything is in hand — taking
// the card nearest the release, say, or the last card it touched — moves the five
// and fails here. Releasing over bare table would have let such a build pass.
//
// NOTHING IS PRESSED FIRST, which is the item: the release is the only pointer
// operation this check drives, and `reset` leaves the last press cleared
// (specs/instrumentation.md), so the release arrives with no press behind it.
//
// WHAT IS READ. The thirteen piles, the waste's set memory, the hand and the
// reported drop target, before the release and after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  releasePoint,
  type Harness,
} from "../harness";
import { boardAndHand } from "./board";

/** The column holding the card a stray release might have moved. */
const CARD_COLUMN = 0;
const CARD = "5H";

/** The column the release lands over, and the card that would accept the five. */
const OVER_COLUMN = 3;
const TARGET = "6S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the board and the hand as they were on a release that follows no press", async () => {
  openTable(h);
  poseColumn(h, CARD_COLUMN, [CARD]);
  poseColumn(h, OVER_COLUMN, [TARGET]);
  const before = boardAndHand(h.snapshot());

  const at = releasePoint(h.snapshot(), "tableau", OVER_COLUMN);
  h.debug.pointerUp(at.x, at.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertNull(
    after.drag,
    "the hand after a release that followed no press: nothing was held, and a " +
      "release lifts nothing (specs/controls.md)",
  );
  assertDeepEqual(
    boardAndHand(after),
    before,
    `the board and the hand after a release over column ${OVER_COLUMN}, which ` +
      `would have accepted the ${CARD} had it been in hand: a release with ` +
      "nothing in hand changes nothing (specs/controls.md)",
  );
});
