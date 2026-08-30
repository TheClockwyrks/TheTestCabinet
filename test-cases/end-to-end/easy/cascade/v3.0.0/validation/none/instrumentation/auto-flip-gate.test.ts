// instrumentation/auto-flip-gate — with the automatic flip gated off, a move that
// exposes a face-down column card leaves it face-down; with the gate on, the same
// move turns it.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: `setAutoFlip(enabled)`
// gates "The turning face-up of a column's newly exposed lowest card. Off, a move
// that empties the face-up cards above a face-down card leaves that card
// face-down." `specs/tableau.md` states the faculty itself: "When an accepted
// move leaves a column whose lowest card is face-down, that card is turned
// face-up."
//
// WHY IT IS ITS OWN POINT. The gate is what lets a scenario keep a card
// face-down through a move it would otherwise turn — the `handling` and `runs`
// groups both pose columns whose faces must stay as they were posed — so a build
// whose gate is ignored would silently turn cards under checks about something
// else entirely.
//
// THE SAME MOVE IS MADE TWICE, ONCE UNDER EACH SETTING, on the same board posed
// twice, so nothing separates the two runs but the gate. A build with a working
// gate and no flip at all fails the second run; a build that flips whatever the
// gate says fails the first; and a build that turns the wrong card fails both
// with the face it reported. One direction alone could not tell the first two
// apart.
//
// THE COLUMN IS THE SMALLEST ONE THE RULE APPLIES TO: a face-down card with a
// single face-up Ace over it, and an empty foundation for the Ace to go to. The
// move is an Ace onto an empty foundation, which `specs/foundations.md` accepts
// whatever the suit, so nothing about ordering, colour or runs is in play, and
// the column is left with exactly one card whose face is the whole reading.
//
// BOTH VERDICTS ARE ASSERTED, because a move the build refused exposed nothing
// and this point would be reading a column it never touched.
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

/** What the reading is of: the face of the card the move exposed. */
interface Exposed {
  accepted: boolean;
  face: string;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the exposed card face-down with the gate off and turns it with the gate on", async () => {
  /** Pose the column, set the gate, make the move, and read what was exposed. */
  const run = async (autoFlip: boolean): Promise<Exposed> => {
    // `openTable` resets, so each run starts from the gates' own defaults and
    // from a table with nothing else on it.
    await openTable(h);
    await h.debug.setAutoFlip(autoFlip);
    await poseColumn(h, COLUMN, [card(BURIED, false), card(LEAVING)]);

    const accepted = await h.debug.move(
      "tableau",
      COLUMN,
      1,
      "foundation",
      FOUNDATION,
    );
    // Read before a frame runs: the flip belongs to the accepted move, so
    // nothing is waiting on an update.
    const left = pileOf(await h.snapshot(), "tableau", COLUMN);
    const lowest = left[left.length - 1];
    return {
      accepted,
      face:
        lowest === undefined
          ? "the column was left empty"
          : lowest.faceUp
            ? "face-up"
            : "face-down",
    };
  };

  const gated = await run(false);
  await h.advance(1);
  // Before the assertions and before the second run, so a failing gate still
  // leaves the picture of the card it was supposed to leave face-down.
  await captureStill(h, "gated");

  const open = await run(true);

  for (const [name, result] of [
    ["with setAutoFlip(false)", gated],
    ["with setAutoFlip(true)", open],
  ] as const) {
    assertEqual(
      result.accepted,
      true,
      `the verdict move() returned ${name} on sending the ${LEAVING} from ` +
        `column ${COLUMN} to the empty foundation ${FOUNDATION}, which ` +
        `accepts an Ace of any suit (specs/foundations.md) — a refused move ` +
        `exposes nothing`,
    );
  }

  assertEqual(
    gated.face,
    "face-down",
    `the face of the ${BURIED} the move exposed with setAutoFlip(false) — the ` +
      `gate stops the turning of a column's newly exposed lowest card ` +
      `(specs/instrumentation.md)`,
  );
  assertEqual(
    open.face,
    "face-up",
    `the face of the ${BURIED} the same move exposed with setAutoFlip(true) — ` +
      `an accepted move that leaves a column's lowest card face-down turns it ` +
      `(specs/tableau.md), so a build that never flips fails here rather than ` +
      `passing on a gate it ignores`,
  );
});
