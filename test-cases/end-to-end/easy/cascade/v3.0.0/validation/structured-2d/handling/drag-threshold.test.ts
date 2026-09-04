// handling/drag-threshold — a short gesture is a click; a longer one is a drop.
//
// THE RULE. specs/controls.md fixes the one thing `DRAG_THRESHOLD` decides:
//
//   | The release point                                    | The gesture |
//   | Within `DRAG_THRESHOLD` (`5`) of the press point     | A click     |
//   | Farther than `DRAG_THRESHOLD` from the press point   | A drop      |
//
// and then separates the two by what each DOES. A click "turns the stock, as
// `specs/stock.md` states, when the press point lies in the stock's drop
// rectangle". A drop "resolves the run in hand against the drop rectangles
// `specs/table.md` fixes. It activates no control and turns no stock."
//
// WHY THE STOCK IS WHERE THIS IS MEASURED. It is the only observable the threshold
// changes at this distance. specs/table.md spaces every pile at a pitch of `122`
// with `100`-wide rectangles, and a held run "travels exactly as far as the
// pointer does" (specs/controls.md), so a gesture of four or six units cannot
// carry a leading card's centre out of the rectangle it began in and into
// another's: the nearest boundary is seventy-two units away across the table and
// eighty-six up it. Both gestures would therefore resolve a held run to the same
// place, and a run put back by a click and a run landed by a drop leave the same
// board. The click's OTHER effect is what the two gestures do not share, and the
// stock is where the specification puts it.
//
// THE MEASUREMENT. Two gestures on one board, both pressing the centre of the
// stock's own drop rectangle:
//
//   release DRAG_THRESHOLD + 1 units away  ->  a drop  ->  the stock does not turn
//   release DRAG_THRESHOLD - 1 units away  ->  a click ->  the stock turns once
//
// One unit either side of the figure, so a build whose threshold is anywhere but
// where the specification puts it answers one of the two wrongly, and the pair
// grades differently from a build that got both wrong. The two figures are
// derived from the `DRAG_THRESHOLD` this project's own `constants.ts` transcribes
// from specs/controls.md, so the build is held to the specification rather than to
// the number it wrote for itself.
//
// BOTH SIDES OF THE DROP ARE READ. An empty waste is what a build that turned
// nothing leaves, and it is also what a build that took cards off the stock and
// lost them leaves, so the stock is read as well: after the long gesture it still
// holds every card it was posed with.
//
// THE LONG GESTURE RUNS FIRST, so the picture kept at the end holds both halves at
// once: a waste carrying exactly one turn's cards is a waste the six-unit gesture
// did not turn and the four-unit gesture did.
//
// THE GESTURES ARE SEPARATED BY MORE THAN `DOUBLE_CLICK_WINDOW`, so the second
// press cannot pair with the first into anything. It could not anyway — a double
// click needs a press "on a playable card" and the stock offers none
// (specs/controls.md) — but the wait costs nothing and leaves the two gestures
// independent.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { DOUBLE_CLICK_WINDOW, DRAG_THRESHOLD } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  dropRectIn,
  framesFor,
  movePointerTo,
  openTable,
  poseStock,
  pressAt,
  rectCenter,
  releaseAt,
  type CardSpec,
  type Harness,
} from "../harness";

/** How far a release lies from its press in each of the two gestures. */
const CLICK_DISTANCE = DRAG_THRESHOLD - 1;
const DROP_DISTANCE = DRAG_THRESHOLD + 1;

/**
 * The stock, bottom card first. Deep enough that one turn leaves cards behind
 * under either deal mode, so a build that emptied the stock instead of turning
 * `TURN_COUNT` reads as a different waste.
 *
 * The turn count is `snapshot().turnCount`, the reading
 * `draw-one/deal-mode-reported` and `draw-three/deal-mode-reported` pin to the
 * specification, rather than the build's own `src/constants` — this suite is
 * common to both deal modes and may spell neither one's figure.
 */
function stockOf(turnCount: number): CardSpec[] {
  return Array.from({ length: 3 * turnCount }, (_, i) => card("hearts", i + 1));
}

/** Frames of quiet between the two gestures: past the double-click window. */
const QUIET = framesFor(DOUBLE_CLICK_WINDOW) + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the stock on a release inside the threshold and not on one outside it", async () => {
  openTable(h);

  const turnCount = h.snapshot().turnCount;
  assertGreaterThan(turnCount, 0, "the turn count this build reports");
  const cards = stockOf(turnCount);

  poseStock(h, cards);

  const at = rectCenter(dropRectIn(h.snapshot(), "stock"));

  // The long gesture: a release past DRAG_THRESHOLD, which is a drop and turns
  // no stock (specs/controls.md).
  pressAt(h, at.x, at.y);
  movePointerTo(h, at.x + DROP_DISTANCE, at.y);
  releaseAt(h, at.x + DROP_DISTANCE, at.y);
  const afterDrop = h.snapshot();

  await h.advance(QUIET);

  // The short gesture: a release inside DRAG_THRESHOLD, which is a click and
  // turns the stock (specs/controls.md, specs/stock.md).
  pressAt(h, at.x, at.y);
  movePointerTo(h, at.x + CLICK_DISTANCE, at.y);
  releaseAt(h, at.x + CLICK_DISTANCE, at.y);
  const afterClick = h.snapshot();

  await h.advance(1);
  captureStill(h, "both");

  assertLength(
    afterDrop.waste,
    0,
    `the cards on the waste after a press on the stock released ` +
      `${String(DROP_DISTANCE)} units away, which is farther than ` +
      `DRAG_THRESHOLD (${String(DRAG_THRESHOLD)}) and so is a drop: a drop ` +
      "turns no stock (specs/controls.md)",
  );
  assertLength(
    afterDrop.stock,
    cards.length,
    `the cards left on the stock after that ${String(DROP_DISTANCE)}-unit ` +
      `gesture, which is the ${String(cards.length)} it was posed with: a ` +
      "drop turns no stock, so nothing left it (specs/controls.md)",
  );
  assertLength(
    afterClick.waste,
    turnCount,
    `the cards on the waste after a press on the stock released ` +
      `${String(CLICK_DISTANCE)} units away, which is within DRAG_THRESHOLD ` +
      `(${String(DRAG_THRESHOLD)}) and so is a click: a click whose press lies ` +
      "in the stock's drop rectangle turns the stock (specs/controls.md, " +
      "specs/stock.md)",
  );
});
