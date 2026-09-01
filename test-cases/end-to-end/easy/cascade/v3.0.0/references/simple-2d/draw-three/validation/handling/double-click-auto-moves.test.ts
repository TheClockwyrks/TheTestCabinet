// handling/double-click-auto-moves — two quick presses on a playable card send it to
// the foundation it belongs on.
//
// specs/controls.md: "A press is a double click when all three hold: it arrives
// within `DOUBLE_CLICK_WINDOW` (`0.30`) seconds of game time of the previous press;
// its point lies within `DOUBLE_CLICK_SLOP` (`20`) of the previous press's point;
// and it lands on a playable card." And then: "the card under it is sent to the
// foundation it belongs on, when that foundation accepts it by
// specs/foundations.md". specs/foundations.md fixes which foundation that is: "the
// one already holding the next-lower card of its own suit".
//
// THE TWO PRESSES ARE INSIDE BOTH FIGURES. They land on the same point, so the slop
// is zero, and `GAP` seconds of game time separate them, a third of the window. The
// clock is `simTime`, which advances only as frames run (specs/instrumentation.md),
// so the gap is driven as frames between the two clicks and is exact rather than
// approximate.
//
// THE POSE. One foundation started with the Ace of spades and one column holding the
// two of spades alone, which is the smallest board on which a card belongs on a
// foundation at all. The column is index 3 rather than 0, so a build that swept the
// tableau from the left rather than answering the press finds nothing to send. Both
// presses land on that card's center, which is the whole of the card: it is its
// column's only card, so nothing is fanned over it.
//
// WHAT THIS DOES NOT DECIDE. Which foundation a card belongs on, and what a
// foundation accepts, are the `automove` and `foundations` groups' requirements.
// This point reads the gesture: that two presses inside the window and the slop are
// what send the card home.

import { afterEach, beforeEach, it } from "vitest";
import { DOUBLE_CLICK_WINDOW } from "../../src/constants";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  clickAt,
  createHarness,
  framesFor,
  openTable,
  pileSpecs,
  poseColumn,
  poseFoundation,
  pressPoint,
  seconds,
  type Harness,
} from "../harness";

/** The foundation the Ace of spades starts. Any suit may start any slot. */
const FOUNDATION = 0;
const FOUNDATION_TOP = "AS";

/** The column the card waits in, named away from the first slot on purpose. */
const COLUMN = 3;
const CARD = "2S";

/**
 * The game time between the two presses, in seconds.
 *
 * A third of `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), so the second press
 * is comfortably inside the window rather than balanced on its edge — the edge
 * belongs to `handling/slow-second-press-does-not`, which drives a gap past it.
 */
const GAP = 0.1;
const GAP_FRAMES = framesFor(GAP);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends the card home on a second press inside the window and the slop", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", 1);
  poseColumn(h, COLUMN, [CARD]);

  const at = pressPoint(h.snapshot(), "tableau", COLUMN, 0);
  clickAt(h, at.x, at.y);
  await h.advance(GAP_FRAMES);
  clickAt(h, at.x, at.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "home");

  assertDeepEqual(
    pileSpecs(after.foundations[FOUNDATION]),
    [FOUNDATION_TOP, CARD],
    `foundation ${FOUNDATION} after two presses ${seconds(GAP_FRAMES)} s and ` +
      `0 units apart on the ${CARD}, well inside DOUBLE_CLICK_WINDOW ` +
      `(${DOUBLE_CLICK_WINDOW}) and DOUBLE_CLICK_SLOP: the card is sent to the ` +
      "foundation it belongs on (specs/controls.md, specs/foundations.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[COLUMN]),
    [],
    `column ${COLUMN} after those two presses: the card that went home has ` +
      "left it (specs/controls.md)",
  );
});
