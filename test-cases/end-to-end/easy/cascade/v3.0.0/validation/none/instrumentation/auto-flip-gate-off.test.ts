// instrumentation/auto-flip-gate-off — with the automatic flip gated off, the
// gate reads back off and a move that exposes a face-down column card leaves it
// face-down.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: `setAutoFlip(enabled)`
// gates "The turning face-up of a column's newly exposed lowest card. Off, a move
// that empties the face-up cards above a face-down card leaves that card
// face-down." Each gate "is reported by `snapshot`", so the pose and its effect
// are both read here.
//
// WHY THE OFF DIRECTION IS ITS OWN POINT. A gate is a switch and a build can fail
// it in two unrelated ways. A switch that never turns the faculty OFF leaves
// every scenario that leans on it grading a faculty it never asked for — the
// `handling` and `runs` groups both pose columns whose faces must stay as they
// were posed — and that is a different cost to the player from a switch that
// never turns the faculty back on. `instrumentation/auto-flip-gate-on` is that
// other half.
//
// THE COLUMN IS THE SMALLEST ONE THE RULE APPLIES TO: a face-down card with a
// single face-up Ace over it, and an empty foundation for the Ace to go to. The
// move is an Ace onto an empty foundation, which `specs/foundations.md` accepts
// whatever the suit, so nothing about ordering, colour or runs is in play, and the
// column is left with exactly one card whose face is the whole reading.
//
// THE VERDICT IS ASSERTED, because a move the build refused exposed nothing and
// this point would be reading a column it never touched.
//
// WHAT THIS DOES NOT DECIDE. The flip rule's own edges — that only ONE card
// turns, that a move leaving a face-up card lowest turns nothing, that emptying
// the column turns nothing — which `tableau/*` grades.

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

it("reports the gate off and leaves the exposed card face-down", async () => {
  await openTable(h);
  await h.debug.setAutoFlip(false);
  await poseColumn(h, COLUMN, [card(BURIED, false), card(LEAVING)]);

  assertEqual(
    (await h.snapshot()).autoFlip,
    false,
    "snapshot().autoFlip after setAutoFlip(false): each gate is reported by " +
      "snapshot (specs/instrumentation.md)",
  );

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    1,
    "foundation",
    FOUNDATION,
  );
  // Read before a frame runs: the flip belongs to the accepted move, so nothing
  // is waiting on an update.
  const left = pileOf(await h.snapshot(), "tableau", COLUMN);
  const lowest = left[left.length - 1];

  await h.advance(SETTLE_FRAMES);
  // Before the assertions, so a failing gate still leaves the picture of the card
  // it was supposed to leave face-down.
  await captureStill(h, "gated");

  assertEqual(
    accepted,
    true,
    `the verdict move() returned on sending the ${LEAVING} from column ` +
      `${COLUMN} to the empty foundation ${FOUNDATION}, which accepts an Ace ` +
      `of any suit (specs/foundations.md) — a refused move exposes nothing`,
  );
  assertEqual(
    lowest === undefined ? "the column was left empty" : lowest.faceUp,
    false,
    `the face of the ${BURIED} the move exposed with setAutoFlip(false) — the ` +
      `gate stops the turning of a column's newly exposed lowest card ` +
      `(specs/instrumentation.md)`,
  );
});
