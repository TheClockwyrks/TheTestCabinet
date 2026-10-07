// winning/win-by-drop — dragging the last card home wins the game.
//
// `specs/victory.md`, The win: "The win is reached by whatever move put the last
// card home, whether a released drop or a double click, and the game moves to the
// `won` screen on that move." `specs/controls.md` says the same from the
// gesture's side: "An applied move is a move like any other, so ... a board it
// completes wins the game, as `specs/victory.md` states."
//
// THIS POINT IS THE DROP HALF OF THAT SENTENCE, and only that half.
// `winning/win-at-fifty-two` decides the rule through `move()` and
// `winning/win-by-double-click` decides the other gesture, so a build that wins
// on a double click but not on a drop grades differently from one that wins on
// neither.
//
// THE GESTURE IS THE REAL ONE. `dragRunTo` presses on the King, carries whatever
// that lifted until the LEADING CARD'S CENTRE sits in the foundation's drop
// rectangle, and releases it there — which is the resolution rule
// `specs/controls.md` fixes ("A drop resolves to the pile whose drop rectangle
// contains the center of the run's leading card"), and the release is far past
// `DRAG_THRESHOLD` from the press, so the gesture is a drop and not a click.
// Nothing is posed onto the foundation: the build's own drop path is what carries
// the card and its own win test is what moves the screen.
//
// THE WIN IS READ WITH NO FRAME ADVANCED. The surface's pointer operations "take
// effect immediately, when called" (`specs/instrumentation.md`), so the whole
// gesture is 0 s of game time and the screen read straight afterwards is the one
// the RELEASE reached rather than one some later frame arrived at. The cascade is
// then read after the recorded frames, which is the second clause of this item:
// the ending has taken over once the gesture is over.
//
// THE REPLAY KEEPS THE TRAIL PAINTING ON. It covers the board, the drop, and the
// cascade's first fifth of a second, which is far inside the recorder's budget,
// and the capture is worth more with the real painted trail in it. The `cascade`
// group's painting-off rule is that group's.

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
  dragRunTo,
  dropRect,
  framesFor,
  openTable,
  pileOf,
  pileTopLeft,
  poseNearlyWon,
  rectCenter,
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
 * Evidence only: it opens the replay on the board the drag starts from. Nothing
 * happens over it — no move is made, so no win test runs.
 */
const BOARD_SECONDS = 0.05;

/**
 * How much of the cascade the replay records after the drop, in seconds.
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

it("wins the game when the last card is dragged onto its foundation", async () => {
  await openTable(h);
  const kingId = await poseNearlyWon(h, {
    suit: MISSING_SUIT,
    at: { pile: "tableau", index: COLUMN },
  });

  const anchor = pileTopLeft("tableau", COLUMN);
  const press = cardCenter(anchor.x, anchor.y);
  const target = rectCenter(dropRect("foundation", FOUNDATION));

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

  const dropped = await captureReplay(h, "drop", async () => {
    await h.advance(framesFor(BOARD_SECONDS));
    await dragRunTo(h, press.x, press.y, target.x, target.y);
    // Read with no frame advanced, so this is the screen the RELEASE reached.
    const state = await h.snapshot();
    await h.advance(framesFor(CASCADE_SECONDS));
    return state;
  });
  const running = await h.snapshot();

  assertEqual(
    dropped.screen,
    "won",
    `the screen the released drop reached, having carried the King of ` +
      `${MISSING_SUIT} into foundation ${FOUNDATION}'s drop rectangle — ` +
      "specs/victory.md: the win is reached by a released drop",
  );
  assertDeepEqual(
    whereIs(dropped, kingId),
    { pile: "foundation", index: FOUNDATION, row: KING_ROW },
    `where the King of ${MISSING_SUIT} (id ${kingId}) landed. A reading naming ` +
      "the column is a drop the build refused or resolved elsewhere",
  );
  assertLength(
    pileOf(dropped, "tableau", COLUMN),
    0,
    `the cards left in column ${COLUMN} — the King left it as the drop applied`,
  );
  assertEqual(
    dropped.foundations.reduce((n, pile) => n + pile.length, 0),
    DECK_SIZE,
    "the cards home the instant the drop was released",
  );
  assertGreaterThanOrEqual(
    running.launched,
    1,
    `cards the cascade has launched ${CASCADE_SECONDS} s after the gesture — ` +
      "specs/victory.md: the victory cascade begins with the win, so the " +
      "ending is running once the drag is over",
  );
});
