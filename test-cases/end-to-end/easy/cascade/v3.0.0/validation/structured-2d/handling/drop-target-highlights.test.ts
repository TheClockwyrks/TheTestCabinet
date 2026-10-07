// handling/drop-target-highlights — the pile a held run would land on is
// reported.
//
// THE RULE. specs/controls.md: "While a run is held, the pile that would accept
// it, if any, is the drop target, and it is drawn as highlighted. A pile is the
// drop target only while the release rule below would resolve the run to it and
// that pile accepts the run. The target is recomputed as the pointer moves."
// specs/instrumentation.md reports it as `dropTarget`, `{ pile, index }` or null.
//
// THE RELEASE RULE it is measured by resolves "to the pile whose drop rectangle
// contains the center of the run's leading card", and specs/table.md fixes those
// rectangles. So the run is carried until its leading card sits exactly on the
// target column's anchor, whose centre lies inside that column's rectangle.
//
// THE TARGET ACCEPTS THE RUN. A red five onto a black six is one rank lower and
// the opposite colour, which specs/tableau.md has a column accept. What a build
// must NOT report is the other half of the rule, and `handling/no-highlight-
// illegal` decides that; this point decides only that a legal target under the
// run is reported.
//
// THE RUN IS CARRIED IN STEPS AND NEVER RELEASED. The target "is recomputed as
// the pointer moves", so the reading is taken while the run is still in hand and
// the gesture is left open — what a release does belongs to the items that decide
// a release.
//
// THE SOURCE COLUMN EMPTIES ON THE LIFT, and an empty column accepts only a run
// led by a King (specs/tableau.md), so nothing on the table but the target can be
// the reported pile.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import {
  captureReplay,
  card,
  cardTopLeft,
  createHarness,
  FIVE,
  grabPoint,
  openTable,
  pileTopLeft,
  poseColumn,
  pressAt,
  movePointerTo,
  SIX,
  type Harness,
} from "../harness";
import { carryTo } from "./gestures";

/** The column the run is lifted from, and the column it is carried over. */
const FROM_COLUMN = 0;
const TO_COLUMN = 1;
/** The row lifted: the source column's only card. */
const FROM_ROW = 0;

/** A red five onto a black six, which specs/tableau.md has a column accept. */
const RUN = card("hearts", FIVE);
const TARGET = card("spades", SIX);

/** The pile `dropTarget` must name while the run is over the target column. */
const REPORTED = { pile: "tableau", index: TO_COLUMN };

/** How many pointer moves the carry is delivered in, one frame apiece. */
const STEPS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the column under the held run while that column accepts it", async () => {
  openTable(h);
  poseColumn(h, FROM_COLUMN, [RUN]);
  poseColumn(h, TO_COLUMN, [TARGET]);

  const posed = h.snapshot();
  const press = grabPoint(posed, FROM_COLUMN, FROM_ROW);
  const lead = cardTopLeft(posed, "tableau", FROM_COLUMN, FROM_ROW);
  // The leading card ends on the target column's anchor, so its centre lies in
  // that column's drop rectangle (specs/table.md).
  const over = carryTo(press, lead, pileTopLeft("tableau", TO_COLUMN));

  pressAt(h, press.x, press.y);
  await captureReplay(h, "highlight", async () => {
    for (let i = 1; i <= STEPS; i += 1) {
      const t = i / STEPS;
      movePointerTo(
        h,
        press.x + (over.x - press.x) * t,
        press.y + (over.y - press.y) * t,
      );
      await h.advance(1);
    }
  });

  const held = h.snapshot();
  assertNotNull(
    held.drag,
    "the run in hand as it is carried, which the press put there " +
      "(specs/controls.md)",
  );
  assertDeepEqual(
    held.dropTarget,
    REPORTED,
    "snapshot().dropTarget with the red five's centre inside column " +
      `${String(TO_COLUMN)}'s drop rectangle, a column whose black six accepts ` +
      "it (specs/controls.md, specs/table.md, specs/tableau.md)",
  );
});
