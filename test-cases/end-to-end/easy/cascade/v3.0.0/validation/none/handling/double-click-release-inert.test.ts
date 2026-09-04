// handling/double-click-release-inert — the release that ends a double click
// changes nothing.
//
// THE RULE. `specs/controls.md`, The double click: "A double click lifts nothing.
// Instead the card under it is sent to the foundation it belongs on ... and the
// gesture ends there; the release that follows changes nothing."
//
// WHY IT IS AN EDGE CASE WORTH GRADING. It is what the general rules imply at a
// boundary rather than a rule of its own, and the way to get it wrong is
// ordinary: a build that treats every release as a release like any other runs
// its click path over a board the auto-move has just changed, and the card that
// went home comes back, or the stock turns, or a second card follows the first.
// The specification spends a clause on it because the auto-move happens on the
// PRESS and a gesture is not over until the finger comes up.
//
// THE PRESS AND THE RELEASE ARE DRIVEN SEPARATELY, which is what makes this point
// different from `handling/double-click-auto-moves`. That point drives two whole
// clicks and reads where the card went; this one drives the second gesture's
// press ALONE, reads the board the auto-move left, then drives the release and
// reads the board again. What it decides is the difference between the two.
//
// THE WHOLE BOARD IS COMPARED, ids and all, so a release that returned the card,
// turned the stock, or moved something else is caught wherever it reached. The
// hand is read as well, because the other way to get this wrong is to lift on the
// release the second press did not lift on.
//
// THE POSE IS `handling/double-click-auto-moves`' — one standing foundation
// holding the next-lower card of the pressed card's own suit, and a column
// holding that card alone — so the card has exactly one place to go and the
// auto-move this point rests on is unambiguous.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  card,
  cardCenter,
  captureStill,
  clickAt,
  createHarness,
  everyCard,
  framesFor,
  openTable,
  pileTopLeft,
  poseColumn,
  poseFoundation,
  type CascadeSnapshot,
  type Harness,
} from "../harness";

/** The foundation the card belongs on, its suit, and how far up it stands. */
const FOUNDATION = 2;
const SUIT = "hearts" as const;
const UP_TO = 5;

/** The column the card sits on, alone and face-up, and which card it is. */
const COLUMN = 3;
const SENT = "6H";

/** Game time between the two presses, a third of `DOUBLE_CLICK_WINDOW` (`0.30`). */
const GAP_SECONDS = 0.1;

/** One frame, so the canvas carries the board the assertions read. */
const SETTLE_FRAMES = 1;

/** Every card on the board, by id and place, so any movement reads as a change. */
function board(s: CascadeSnapshot): string {
  return everyCard(s)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((c) => `${c.id}:${c.suit}-${c.rank}${c.faceUp ? "u" : "d"}`)
    .join(" ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the board the auto-move made exactly as it found it", async () => {
  await openTable(h);
  await poseFoundation(h, FOUNDATION, SUIT, UP_TO);
  await poseColumn(h, COLUMN, [card(SENT)]);

  const at = pileTopLeft("tableau", COLUMN);
  const press = cardCenter(at.x, at.y);

  // The first whole click, then the second press ALONE.
  await clickAt(h, press.x, press.y);
  await h.advance(framesFor(GAP_SECONDS));
  await h.debug.pointerDown(press.x, press.y);

  // What the double click's own auto-move left, read before the release.
  const sent = await h.snapshot();
  assertEqual(
    sent.foundations[FOUNDATION].length,
    UP_TO + 1,
    `posing: the cards on foundation ${FOUNDATION} once the second press sent ` +
      `the ${SENT} home — a double click that never happened leaves this ` +
      `point no release to grade (specs/controls.md)`,
  );
  const standing = board(sent);

  await h.debug.pointerUp(press.x, press.y);
  const after = await h.snapshot();

  await h.advance(SETTLE_FRAMES);
  // Before the assertions, so a release that undid the move still leaves the
  // picture of the board it left.
  await captureStill(h, "unchanged");

  assertEqual(
    board(after),
    standing,
    "the cards on the board after the release that ended the double click, " +
      "against the board its press left — the gesture ends at the press, and " +
      "the release that follows changes nothing (specs/controls.md)",
  );
  assertEqual(
    after.drag,
    null,
    "the run in hand after that release — a double click lifts nothing, so " +
      "there was nothing for the release to put down (specs/controls.md)",
  );
});
