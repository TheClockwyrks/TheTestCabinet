// instrumentation/auto-flip-gate-on — with the automatic flip gated back on, the
// gate reads back on and the same move turns the exposed card face-up.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: `setAutoFlip(enabled)`
// gates "The turning face-up of a column's newly exposed lowest card", and each
// gate "is reported by `snapshot`". `specs/tableau.md` states the faculty itself:
// "When an accepted move leaves a column whose lowest card is face-down, that
// card is turned face-up."
//
// WHY THE ON DIRECTION IS ITS OWN POINT, AND WHY IT TURNS THE GATE OFF FIRST. A
// switch that never turns the faculty back ON leaves the faculty itself dead in
// normal play, which costs the player something completely different from a
// switch that never turns it off (`instrumentation/auto-flip-gate-off`). Setting
// the gate to `true` from `false` rather than reading the default is what makes
// this a reading of the SWITCH: a build that ignores the operation entirely and
// always flips would otherwise pass on a value it never honoured.
//
// THE BOARD IS THE OFF DIRECTION'S, POSED THE SAME WAY, so nothing separates the
// two points but the gate: a face-down card with a single face-up Ace over it,
// and an empty foundation, which `specs/foundations.md` accepts an Ace of any
// suit onto.
//
// THE VERDICT IS ASSERTED, because a move the build refused exposed nothing.
//
// WHAT THIS DOES NOT DECIDE. The flip rule's own edges, which `tableau/*` grades,
// and that the gate starts on, which is
// `instrumentation/auto-flip-defaults-on`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  openTable,
  pileOf,
  poseColumn,
  type Harness,
} from "../harness";

/** The column the move empties down to its face-down card, and the target. */
const COLUMN = 0;
const FOUNDATION = 0;

/** The column, bottom card first: a face-down card under the Ace that leaves. */
const BURIED = "7C";
const LEAVING = "AS";

/** One frame, so a still carries the table the reading was taken from. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the gate on again and turns the exposed card face-up", async () => {
  await openTable(h);
  // Off and then on, so what is read is the operation rather than a default.
  await h.debug.setAutoFlip(false);
  await h.debug.setAutoFlip(true);
  await poseColumn(h, COLUMN, [card(BURIED, false), card(LEAVING)]);

  assertEqual(
    (await h.snapshot()).autoFlip,
    true,
    "snapshot().autoFlip after setAutoFlip(true) followed setAutoFlip(false): " +
      "each gate is reported by snapshot (specs/instrumentation.md)",
  );

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    1,
    "foundation",
    FOUNDATION,
  );
  const left = pileOf(await h.snapshot(), "tableau", COLUMN);
  const lowest = left[left.length - 1];

  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "turned");

  assertEqual(
    accepted,
    true,
    `the verdict move() returned on sending the ${LEAVING} from column ` +
      `${COLUMN} to the empty foundation ${FOUNDATION}, which accepts an Ace ` +
      `of any suit (specs/foundations.md) — a refused move exposes nothing`,
  );
  assertEqual(
    lowest === undefined ? "the column was left empty" : lowest.faceUp,
    true,
    `the face of the ${BURIED} the move exposed with setAutoFlip(true) — an ` +
      `accepted move that leaves a column's lowest card face-down turns it ` +
      `(specs/tableau.md), so a build that never flips fails here rather than ` +
      `passing on a gate it ignores`,
  );
});
