// handling/far-second-press-does-not — a second press past the slop is not a double
// click.
//
// specs/controls.md: a press is a double click only when "its point lies within
// `DOUBLE_CLICK_SLOP` (`20`) of the previous press's point", among two other
// conditions. This point holds the other two fixed and breaks that one: the two
// presses are `GAP` seconds apart, a third of the window, and both land on the SAME
// playable card that a foundation would accept — so the only thing wrong with them
// is the `OFFSET` units between them.
//
// THE SECOND PRESS STAYS ON THE CARD. A card is `CARD_W x CARD_H` (`100 x 140`,
// specs/table.md) and the presses are `40` units apart along the card's width, so
// both land inside its footprint and both resolve to it (specs/controls.md). That
// matters: the third condition of the rule is that the press "lands on a playable
// card", and a second press that had slid off the card would fail the rule for two
// reasons at once and the item would no longer name which.
//
// THE OFFSET IS PAST THE SLOP BY A MARGIN. `40` units against `20` is twice it, so a
// build whose slop is a little wide still fails while a build that reads the figure
// as stated passes with room.
//
// THE SECOND GESTURE IS A WHOLE CLICK, press and release at one point, so a press
// that is not a double click lifts the card and its release returns it
// (specs/controls.md) and a conforming build ends with the card where it started.

import { afterEach, beforeEach, it } from "vitest";
import { DOUBLE_CLICK_SLOP } from "../../src/constants";
import { assertDeepEqual, assertNull } from "../assert";
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
  type Harness,
} from "../harness";

/** The foundation the Ace of spades starts, and the card that would go home. */
const FOUNDATION = 0;
const FOUNDATION_TOP = "AS";
const COLUMN = 3;
const CARD = "2S";

/**
 * The game time between the two presses, in seconds.
 *
 * A third of `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), so the window is
 * satisfied and the slop is the only condition this point breaks.
 */
const GAP = 0.1;
const GAP_FRAMES = framesFor(GAP);

/**
 * How far the second press lands from the first, along the card's width.
 *
 * Twice `DOUBLE_CLICK_SLOP` (`20`, specs/controls.md), and still inside the card:
 * the first press is at the card's center and a card is `100` wide, so a point `40`
 * to its right is `10` units short of the card's right edge.
 */
const OFFSET = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the card where it was when the second press falls past the slop", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", 1);
  poseColumn(h, COLUMN, [CARD]);

  const at = pressPoint(h.snapshot(), "tableau", COLUMN, 0);
  clickAt(h, at.x, at.y);
  await h.advance(GAP_FRAMES);
  clickAt(h, at.x + OFFSET, at.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertDeepEqual(
    pileSpecs(after.tableau[COLUMN]),
    [CARD],
    `column ${COLUMN} after two presses ${OFFSET} units apart on the ` +
      `${CARD}, past DOUBLE_CLICK_SLOP (${DOUBLE_CLICK_SLOP}): the second ` +
      "press is not a double click, so the card stays where it was " +
      "(specs/controls.md)",
  );
  assertDeepEqual(
    pileSpecs(after.foundations[FOUNDATION]),
    [FOUNDATION_TOP],
    `foundation ${FOUNDATION} after those two presses: nothing was sent home ` +
      "(specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the hand after the second release, which lies within DRAG_THRESHOLD of " +
      "its press and is therefore a click that returns the run " +
      "(specs/controls.md)",
  );
});
