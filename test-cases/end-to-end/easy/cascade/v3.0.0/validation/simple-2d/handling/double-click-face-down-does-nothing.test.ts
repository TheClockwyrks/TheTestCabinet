// handling/double-click-face-down-does-nothing — two quick presses on a column's
// face-down card do nothing.
//
// THE RULE. `specs/controls.md`, The double click: a press is a double click only
// when, among the three conditions, "it lands on a playable card", and "A playable
// card is the waste's top card or a column's lowest face-up card." A face-down
// card is neither, so the second press is not a double click and there is nothing
// to send home.
//
// WHY IT IS AN EDGE CASE WORTH GRADING. It is what the rules imply at a boundary
// rather than a rule of its own, and the ordinary way to get it wrong is to test
// the window and the slop and forget the third condition: a build that sends
// whatever card lies under two quick presses turns a face-down card face-up on a
// foundation, which is a card the player has not seen.
//
// THE COLUMN IS POSED SO THE FACE-DOWN CARD IS THE LOWEST ONE, which is the
// position a playable card would occupy, so a build reading "the lowest card"
// without reading its face is caught. And the foundation it would belong on is
// posed STANDING and one rank short of it, so a build that ignored the face has
// somewhere to send it — a board on which nothing could move would pass this
// point for the wrong reason.
//
// THE WHOLE BOARD IS COMPARED, ids and all, so a build that moved something else
// is caught wherever it reached; and the hand is read, because the other way to
// answer a press on a face-down card wrongly is to lift it.
// `handling/press-face-down-grabs-nothing` is the point that grades the lift on a
// single press.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  cardCenter,
  columnCardTopLeft,
  createHarness,
  framesFor,
  openTable,
  poseColumn,
  poseFoundation,
  tableCards,
  tapPointer,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The foundation the buried card would belong on, its suit, and its height. */
const FOUNDATION = 2;
const SUIT = "hearts" as const;
const UP_TO = 5;

/** The column, bottom card first: the six of hearts posed FACE-DOWN and lowest. */
const COLUMN = 3;
const CARDS = ["#6H"] as const;

/** Game time between the two presses, a third of `DOUBLE_CLICK_WINDOW` (`0.30`). */
const GAP_SECONDS = 0.1;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

/** Every card on the board, by id and face, so any movement reads as a change. */
function board(s: CascadeSnapshot): string {
  return tableCards(s)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((c) => `${c.id}:${c.suit}-${c.rank}${c.faceUp ? "u" : "d"}`)
    .join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the face-down card where it was", async () => {
  openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, UP_TO);
  await poseColumn(h, COLUMN, [...CARDS]);

  const standing = board(h.snapshot());

  const at = columnCardTopLeft(
    COLUMN,
    0,
    CARDS.map((spec) => !spec.startsWith("#")),
  );
  const press = cardCenter(at.x, at.y);
  await tapPointer(h, press.x, press.y);
  await h.advance(framesFor(GAP_SECONDS));
  await tapPointer(h, press.x, press.y);

  await h.advance(SETTLE_FRAMES);
  const after = h.snapshot();
  // Before the assertions, so a build that sent the card home still leaves the
  // picture of the board it made.
  captureStill(h, "unchanged");

  assertEqual(
    board(after),
    standing,
    "the cards on the board after two quick presses on a column's face-down " +
      "card, against the board they were posed on — a double click lands on a " +
      "playable card, and a playable card is the waste's top card or a " +
      "column's lowest FACE-UP card (specs/controls.md)",
  );
  assertEqual(
    after.drag,
    null,
    "the run in hand after those presses — a press on a face-down card lifts " +
      "nothing (specs/controls.md)",
  );
});
