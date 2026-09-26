// handling/short-gesture-is-a-click — a release within `DRAG_THRESHOLD` of its
// press is a click, and the stock is where the two part company.
//
// THE RULE. `specs/controls.md` fixes both sides. A release "Within
// `DRAG_THRESHOLD` (`5`) of the press point" is "A click", and one "Farther than
// `DRAG_THRESHOLD` from the press point" is "A drop". A click "turns the stock, as
// `specs/stock.md` states, when the press point lies in the stock's drop
// rectangle", while "A drop resolves the run in hand against the drop rectangles
// `specs/table.md` fixes. It turns no stock."
//
// WHY THE STOCK, AND NOT A CARD CARRIED TOWARD A COLUMN. Because on this table a
// card cannot say which kind of gesture it was. `specs/table.md` puts the thirteen
// drop rectangles at least `16` units apart — the `22`-unit gaps between the
// columns, and the gap between the top row's bottom edge at `y = 164` and the
// columns' top edge at `TABLEAU_Y` (`180`) — so a run moved four or six units from
// where it was lifted still has its leading card's centre inside its OWN source
// pile's rectangle, or inside no rectangle at all. A drop resolving to the source
// pile returns the run to exactly where a click would have returned it, and a drop
// resolving to no pile does the same. Both readings of the threshold therefore
// leave the card in its source column, and a check built that way would grade
// nothing. The stock is the one place the two kinds of gesture part company over a
// distance this small, so it is where this point reads them.
//
// THE MARGIN IS ONE LOGICAL UNIT, which is the smallest margin that can straddle
// a whole-numbered figure, and the gesture does not sit on the boundary itself.
// `specs/controls.md` puts the boundary on the click's side.
// `handling/long-gesture-is-a-drop` is the other half, driven the same way at the
// other distance.
//
// THE TURN COUNT IS READ RATHER THAN WRITTEN, since it is one of the four figures
// that differ between the deal modes; `handling/stock-click-turns` is the point
// that grades the click's turn on its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  card,
  cardCenter,
  createHarness,
  FIVE,
  FOUR,
  JACK,
  NINE,
  openTable,
  pileTopLeft,
  poseStock,
  SEVEN,
  TWO,
  up,
  type Harness,
} from "../harness";
import { DRAG_THRESHOLD } from "../constants";

/** The stock, bottom card first. More than any deal mode's turn takes. */
const STOCK = [
  up(card("clubs", TWO)),
  up(card("hearts", FIVE)),
  up(card("spades", NINE)),
  up(card("diamonds", JACK)),
  up(card("clubs", FOUR)),
  up(card("hearts", SEVEN)),
] as const;

/** This point's gesture length: a unit inside `DRAG_THRESHOLD` (`5`). */
const TRAVEL = DRAG_THRESHOLD - 1;

/** One frame, so the canvas carries the board the assertion reads. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the stock on a gesture inside the threshold", async () => {
  openTable(h);
  await poseStock(h, [...STOCK]);

  const turnCount = h.snapshot().turnCount;
  assertGreaterThan(
    turnCount,
    0,
    "posing: the turn count this build reports — a build that turns nothing " +
      "has no gesture for this point to read",
  );

  // Press on the stock, travel exactly `TRAVEL` units, and release there.
  const anchor = pileTopLeft("stock");
  const press = cardCenter(anchor.x, anchor.y);
  h.debug.pointerDown(press.x, press.y);
  h.debug.pointerMove(press.x + TRAVEL, press.y);
  h.debug.pointerUp(press.x + TRAVEL, press.y);

  await h.advance(SETTLE_FRAMES);
  // Before the assertion, so a gesture read the wrong way still leaves the
  // picture of the board it left.
  captureStill(h, "click");

  assertLength(
    h.snapshot().waste,
    turnCount,
    `the cards on the waste after a ${TRAVEL}-unit gesture on the stock, ` +
      `which is a click because its release lies within DRAG_THRESHOLD ` +
      `(${DRAG_THRESHOLD}) of its press (specs/controls.md) — a click turns the stock`,
  );
});
