// handling/slow-second-press-does-not — a second press past the window is not a
// double click.
//
// specs/controls.md: a press is a double click only when "it arrives within
// `DOUBLE_CLICK_WINDOW` (`0.30`) seconds of game time of the previous press", among
// two other conditions. This point holds the other two conditions fixed and breaks
// that one: the two presses land on the same point, on a playable card that a
// foundation would accept, and the only thing wrong with them is that they are
// `GAP` seconds apart.
//
// THE GAP IS PAST THE WINDOW BY A MARGIN. `0.4` s against `0.30` s is a third again
// over it, so a build whose window is a little wide still fails, while a build that
// reads the figure as stated passes with room. The clock is `simTime`, which
// advances only as frames run (specs/instrumentation.md), so the gap is driven as
// frames and is exact.
//
// THE SECOND GESTURE IS A WHOLE CLICK, press and release at one point. A press that
// is not a double click lifts what the grab rule gives it, and the release, being
// within `DRAG_THRESHOLD` of that press, is a click and returns the run
// (specs/controls.md) — so a conforming build ends with the card exactly where it
// started, which is what "leave the card where it was" means here.
//
// THE POSE is `handling/double-click-auto-moves`'s, unchanged: the same Ace home, the
// same card in the same column, the same press point. Only the gap differs, so a
// build that fails one and passes the other has been graded on the window alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import { DOUBLE_CLICK_WINDOW } from "../constants";
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

/** The foundation the Ace of spades starts, and the card that would go home. */
const FOUNDATION = 0;
const FOUNDATION_TOP = "AS";
const COLUMN = 3;
const CARD = "2S";

/**
 * The game time between the two presses, in seconds.
 *
 * `0.4` s against a `DOUBLE_CLICK_WINDOW` of `0.30` s (specs/controls.md), so the
 * second press falls a third of the window past its end.
 */
const GAP = 0.4;
const GAP_FRAMES = framesFor(GAP);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the card where it was when the second press falls past the window", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", 1);
  poseColumn(h, COLUMN, [CARD]);

  const at = pressPoint(h.snapshot(), "tableau", COLUMN, 0);
  clickAt(h, at.x, at.y);
  await h.advance(GAP_FRAMES);
  clickAt(h, at.x, at.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertDeepEqual(
    pileSpecs(after.tableau[COLUMN]),
    [CARD],
    `column ${COLUMN} after two presses ${seconds(GAP_FRAMES)} s apart, past ` +
      `DOUBLE_CLICK_WINDOW (${DOUBLE_CLICK_WINDOW}): the second press is not a ` +
      "double click, so the card stays where it was (specs/controls.md)",
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
