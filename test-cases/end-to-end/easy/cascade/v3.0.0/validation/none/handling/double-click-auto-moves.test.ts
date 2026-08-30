// handling/double-click-auto-moves — two presses a tenth of a second apart at
// one point send the card under them to the foundation it belongs on.
//
// `specs/controls.md` fixes it: a press is a double click when it arrives "within
// `DOUBLE_CLICK_WINDOW` (`0.30`) seconds of game time of the previous press", its
// point lies "within `DOUBLE_CLICK_SLOP` (`20`) of the previous press's point",
// and "it lands on a playable card" — and "the card under it is sent to the
// foundation it belongs on, when that foundation accepts it by
// `specs/foundations.md`". `specs/foundations.md` names that foundation: "the one
// already holding the next-lower card of its own suit".
//
// THE TWO PRESSES ARE `0.1` s OF GAME TIME APART, a third of the window, driven
// by advancing the game between them. That is well inside the window and well
// inside the slop, since both presses land on the same point, so the only thing
// this check can fail on is the double click itself. Its two refusal directions
// are `handling/slow-second-press-does-not` and
// `handling/far-second-press-does-not`, which sit outside each figure in turn.
//
// WHAT THE POSE DISTINGUISHES. Only one foundation is standing and it holds the
// next-lower card of the pressed card's own suit, so the card has exactly one
// place to go and a build that sends it to a foundation chosen by slot rather
// than by suit reads as a different board. The column holds that card alone, so
// "a column's lowest face-up card" is unambiguous.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  card,
  cardCenter,
  captureStill,
  clickAt,
  createHarness,
  framesFor,
  openTable,
  pileOf,
  pileTopLeft,
  poseColumn,
  poseFoundation,
  whereIs,
  type Harness,
} from "../harness";

/** The foundation the card belongs on, its suit, and how far up it stands. */
const FOUNDATION = 2;
const SUIT = "hearts" as const;
const UP_TO = 5;

/** The column the card sits on, alone and face-up, and which card it is. */
const COLUMN = 3;
const SENT = "6H";

/**
 * Game time between the two presses, a third of `DOUBLE_CLICK_WINDOW` (`0.30`).
 *
 * The item's own figure, and far enough inside the window that no build's
 * accounting of elapsed time could put it outside.
 */
const GAP_SECONDS = 0.1;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sends the card home on the second of two quick presses", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, UP_TO);
  const [sentId] = await poseColumn(h, COLUMN, [card(SENT)]);

  const at = pileTopLeft("tableau", COLUMN);
  const press = cardCenter(at.x, at.y);

  await clickAt(h, press.x, press.y);
  await h.advance(framesFor(GAP_SECONDS));
  await clickAt(h, press.x, press.y);

  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "home");

  const after = await h.snapshot();
  assertDeepEqual(
    whereIs(after, sentId),
    { pile: "foundation", index: FOUNDATION, row: UP_TO },
    "where the two presses sent the card",
  );
  assertLength(
    pileOf(after, "tableau", COLUMN),
    0,
    "the cards the column is left holding",
  );
});
