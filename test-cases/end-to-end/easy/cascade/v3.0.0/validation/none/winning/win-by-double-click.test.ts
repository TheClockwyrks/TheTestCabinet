// winning/win-by-double-click — double-clicking the last card home wins the game.
//
// `specs/victory.md`, The win: "The win is reached by whatever move put the last
// card home, whether a released drop or a double click, and the game moves to the
// `won` screen on that move." `specs/controls.md` states the gesture: a second
// press inside `DOUBLE_CLICK_WINDOW` (`0.30` s of game time) and
// `DOUBLE_CLICK_SLOP` (`20`) of the previous press, landing on a playable card,
// "is sent to the foundation it belongs on ... Sending a card home this way is a
// move like any other, so it turns a newly exposed column card and it can win the
// game."
//
// THIS POINT IS THE DOUBLE-CLICK HALF OF THAT SENTENCE, and only that half.
// `winning/win-by-drop` decides the other gesture and `winning/win-at-fifty-two`
// the rule underneath both, so a build that wins on a drop but not on a double
// click grades differently from one that wins on neither. What the double click
// does to a card that is NOT the last one is `automove` and `handling`'s; what is
// decided here is that this gesture can end the game.
//
// THE CARD IS THE COLUMN'S LOWEST FACE-UP CARD, which is what `specs/controls.md`
// calls playable, and it is alone in its column, so the press point resolves to
// it and to nothing else. `doubleClickAt` drives two presses with no advance
// between them, so they are 0 s of game time apart and 0 units apart: inside both
// the window and the slop with room to spare, because neither figure is this
// point's subject — `handling/double-click-window` and
// `handling/double-click-slop` are where those boundaries are graded.
//
// THE WIN IS READ WITH NO FRAME ADVANCED. The surface's pointer operations "take
// effect immediately, when called" (`specs/instrumentation.md`), so the screen
// read straight after the second press is the one that press reached. The cascade
// is then read after the recorded frames, which is this item's second clause.
//
// THE REPLAY KEEPS THE TRAIL PAINTING ON, for the reason `winning/win-by-drop`
// states: it covers the board, the gesture and a fifth of a second of cascade,
// far inside the recorder's budget.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
} from "../assert";
import { DECK_SIZE, RANK_MAX, SUITS } from "../constants";
import {
  captureReplay,
  cardCenter,
  createHarness,
  doubleClickAt,
  framesFor,
  openTable,
  pileOf,
  pileTopLeft,
  poseNearlyWon,
  whereIs,
  type Harness,
} from "../harness";

/** The column the one card kept out waits on, alone and face-up. */
const COLUMN = 0;

/** The suit kept out. Its foundation stands at the Queen and is owed the King. */
const MISSING_SUIT = "clubs" as const;

/** The foundation that suit's cards are on — `poseNearlyWon` gives it `SUITS[i]`. */
const FOUNDATION = SUITS.indexOf(MISSING_SUIT);

/** Where the King lands on its foundation, counted from the bottom: thirteenth. */
const KING_ROW = RANK_MAX - 1;

/**
 * How long the board is shown before the gesture, in seconds of game time.
 *
 * Evidence only: it opens the replay on the board the double click starts from.
 * Nothing happens over it — no move is made, so no win test runs.
 */
const BOARD_SECONDS = 0.05;

/**
 * How much of the cascade the replay records after the gesture, in seconds.
 *
 * A fifth of a second is `floor(0.2 / LAUNCH_INTERVAL) + 1` = 2 cards launched by
 * `specs/victory.md`'s cadence: the ending visibly under way, and few enough
 * painted frames to stay well inside the recorder's capture budget.
 */
const CASCADE_SECONDS = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("wins the game when the last card is double-clicked home", async () => {
  await openTable(h);
  const kingId = await poseNearlyWon(h, {
    suit: MISSING_SUIT,
    at: { pile: "tableau", index: COLUMN },
  });

  const anchor = pileTopLeft("tableau", COLUMN);
  const press = cardCenter(anchor.x, anchor.y);

  const before = await h.snapshot();
  assertEqual(
    before.winDetect,
    true,
    "the win-detection gate this check leaves at its reset default, so the " +
      "build's own win test is what decides the screen (specs/instrumentation.md)",
  );
  assertEqual(
    before.screen,
    "playing",
    "the screen with fifty-one cards home and one still out",
  );

  const clicked = await captureReplay(h, "double-click", async () => {
    await h.advance(framesFor(BOARD_SECONDS));
    await doubleClickAt(h, press.x, press.y);
    // Read with no frame advanced, so this is the screen the second press
    // reached.
    const state = await h.snapshot();
    await h.advance(framesFor(CASCADE_SECONDS));
    return state;
  });
  const running = await h.snapshot();

  assertEqual(
    clicked.screen,
    "won",
    `the screen the double click reached, having sent the King of ` +
      `${MISSING_SUIT} home from column ${COLUMN} — specs/victory.md: the win ` +
      "is reached by a double click as much as by a released drop",
  );
  assertDeepEqual(
    whereIs(clicked, kingId),
    { pile: "foundation", index: FOUNDATION, row: KING_ROW },
    `where the King of ${MISSING_SUIT} (id ${kingId}) went. A reading naming ` +
      "the column is a build whose double click sent nothing home",
  );
  assertLength(
    pileOf(clicked, "tableau", COLUMN),
    0,
    `the cards left in column ${COLUMN} — the King left it as the move applied`,
  );
  assertEqual(
    clicked.foundations.reduce((n, pile) => n + pile.length, 0),
    DECK_SIZE,
    "the cards home the instant the second press was handled",
  );
  assertGreaterThanOrEqual(
    running.launched,
    1,
    `cards the cascade has launched ${CASCADE_SECONDS} s after the gesture — ` +
      "specs/victory.md: the victory cascade begins with the win, so the " +
      "ending is running once the second press has been handled",
  );
});
