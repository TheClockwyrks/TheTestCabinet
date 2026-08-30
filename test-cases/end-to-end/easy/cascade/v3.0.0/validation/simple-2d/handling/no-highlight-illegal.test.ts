// handling/no-highlight-illegal — a pile that would refuse the run is not reported
// as the drop target.
//
// specs/controls.md: "A pile is the drop target only while the release rule below
// would resolve the run to it AND that pile accepts the run." So a run carried over
// a pile the rules refuse leaves `dropTarget` null, however squarely it sits over
// that pile.
//
// THE RUN IS SQUARELY OVER THE PILE. The press is at the card's center, which makes
// the offset between the pointer and the leading card's center zero, and the pointer
// is then carried to the center of the target column's drop rectangle
// (specs/table.md) — so the leading card's center lies inside that rectangle, and
// the resolution half of the rule is satisfied. What is left is the acceptance half,
// which is the item.
//
// THE REFUSAL IS BY COLOR, NOT BY RANK. specs/tableau.md has a column whose lowest
// card is of rank `r` and color `c` accept a run led by a card of rank `r - 1` and
// THE OTHER COLOR. The red five is carried over a column whose lowest card is the
// red six: the rank is exactly right and the color is exactly wrong, so a build that
// checks only the rank reports the target and fails here, while a build that checks
// both leaves it null.
//
// WHAT THIS DOES NOT DECIDE. That a legal target IS reported is
// `handling/drop-target-highlights`; a build that reports nothing anywhere passes
// this point and fails that one.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  pressPoint,
  releasePoint,
  type Harness,
} from "../harness";

/** The column the run is lifted from, and the run: one red five. */
const FROM_COLUMN = 0;
const RUN = "5H";

/** The column it is carried over, and its lowest card: a red six, which refuses. */
const OVER_COLUMN = 3;
const REFUSING = "6H";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the drop target null while the run is over a pile that refuses it", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, OVER_COLUMN, [REFUSING]);

  const press = pressPoint(h.snapshot(), "tableau", FROM_COLUMN, 0);
  const over = releasePoint(h.snapshot(), "tableau", OVER_COLUMN);
  h.debug.pointerDown(press.x, press.y);
  h.debug.pointerMove(over.x, over.y);
  const held = h.snapshot();
  await h.advance(1);
  captureStill(h, "unhighlighted");

  assertNotNull(
    held.drag,
    `the run in hand over column ${OVER_COLUMN}: the target is the pile a ` +
      "HELD run would land on (specs/controls.md)",
  );
  assertNull(
    held.dropTarget,
    `the drop target while the ${RUN} is over column ${OVER_COLUMN}, whose ` +
      `lowest card is the ${REFUSING}: the same color, so the column refuses ` +
      "the run and is not the target (specs/controls.md, specs/tableau.md)",
  );
});
