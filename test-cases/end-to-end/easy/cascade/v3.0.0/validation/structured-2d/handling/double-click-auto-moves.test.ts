// handling/double-click-auto-moves — two quick presses on a playable card send it
// home.
//
// THE RULE. specs/controls.md: "A press is a double click when all three hold: it
// arrives within `DOUBLE_CLICK_WINDOW` (`0.30`) seconds of game time of the
// previous press; its point lies within `DOUBLE_CLICK_SLOP` (`20`) of the previous
// press's point; it lands on a playable card." And then: "A double click lifts
// nothing. Instead the card under it is sent to the foundation it belongs on, when
// that foundation accepts it ... and the gesture ends there; the release that
// follows changes nothing."
//
// THE SEPARATION. The two presses are `0.1` seconds of game time apart, a third of
// the window, and land on the same point, so every one of the three conditions
// holds with room to spare. The suite steps at 60 Hz, so `0.1` s is six whole
// frames and the separation is exact on any machine. This point decides the
// direction where the gesture DOES fire; `handling/slow-second-press-does-not` and
// `handling/far-second-press-does-not` decide the two it must not.
//
// WHERE THE CARD GOES. specs/controls.md: "A playable card is the waste's top card
// or a column's lowest face-up card", sent "to the foundation it belongs on".
// specs/foundations.md: the foundation whose top card is rank `r` of suit `s`
// accepts rank `r + 1` of that suit. So the two of spades on a column, over a
// foundation holding the Ace of spades, has exactly one foundation to belong to
// and the reading is unambiguous.
//
// THE TABLE HOLDS NOTHING ELSE. One started foundation and one card on one column,
// so no other card could have gone home and no other foundation could have taken
// this one. `automove/*` decides what the auto-move itself does; this point decides
// that the GESTURE reaches it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import { DOUBLE_CLICK_WINDOW } from "../constants";
import {
  ACE,
  captureStill,
  card,
  clickAt,
  createHarness,
  framesFor,
  grabPoint,
  openTable,
  poseColumn,
  poseFoundation,
  secondsFor,
  TWO,
  type Harness,
} from "../harness";
import { pileText } from "./gestures";

/** The foundation the Ace of spades starts, and the suit in play. */
const FOUNDATION = 0;
const SUIT = "spades";

/** The card on the column: one rank above the foundation's top, of its suit. */
const COLUMN = 0;
const CARDS = [card(SUIT, TWO)];

/**
 * How many frames separate the two presses.
 *
 * A third of the frames `DOUBLE_CLICK_WINDOW` (`0.30`, specs/controls.md) covers
 * at the suite's clock — six frames, `0.1` s of game time — so the second press
 * is inside the window by two thirds of it and lands on a whole frame boundary,
 * with no rounding anywhere near the edge. The window is read off this project's
 * own `constants.ts`, which transcribes it from specs/controls.md, rather than
 * off the build's module or a literal here.
 */
const GAP_FRAMES = Math.round(framesFor(DOUBLE_CLICK_WINDOW) / 3);

/** That gap as the seconds of game time a failure names. */
const SEPARATION = secondsFor(GAP_FRAMES);

/** The two piles as they must read after the gesture. */
const HOME = ["AS", "2S"];
const EMPTIED: string[] = [];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sends the card under two quick presses to the foundation it belongs on", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, SUIT, ACE);
  poseColumn(h, COLUMN, CARDS);

  const at = grabPoint(h.snapshot(), COLUMN, 0);
  clickAt(h, at.x, at.y);
  await h.advance(GAP_FRAMES);
  clickAt(h, at.x, at.y);

  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "home");

  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    HOME,
    `foundation ${String(FOUNDATION)} after two presses ` +
      `${String(SEPARATION)} s apart at one point on the two of spades, which ` +
      "is a double click and sends the card home (specs/controls.md, " +
      "specs/foundations.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[COLUMN]),
    EMPTIED,
    `column ${String(COLUMN)} after the gesture: the card it held has gone ` +
      "home (specs/controls.md)",
  );
  assertNull(
    after.drag,
    "the run in hand after the gesture: a double click lifts nothing " +
      "(specs/controls.md)",
  );
});
