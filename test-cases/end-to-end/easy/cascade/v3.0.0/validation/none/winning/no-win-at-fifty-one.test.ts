// winning/no-win-at-fifty-one — fifty-one cards home is not a win.
//
// `specs/victory.md`, The win: "The game is won the instant all `DECK_SIZE`
// (`52`) cards are on the foundations, each foundation complete from its Ace to
// its King." Fifty-two, and nothing less. This is the other direction of
// `winning/win-at-fifty-two`: a build whose test is `>= 51`, or that counts a
// foundation complete at the Queen, or that wins when it has run out of legal
// moves, reads `won` here and a conformant build reads `playing`.
//
// THE FIFTY-FIRST CARD IS CARRIED HOME BY A REAL MOVE, not posed there. The win
// test runs on a move (`specs/victory.md`: "The win is reached by whatever move
// put the last card home"), so a scenario that merely ARRANGES fifty-one cards on
// the foundations never asks the build the question — `addCard` "touches no other
// pile and no other field" (`specs/instrumentation.md`) and no win test fires.
// So fifty cards are placed, the fifty-first is moved home by the game's own
// rules, and the reading is taken on the move that would be the win if the build
// counted wrong.
//
// THE DISTINGUISHING VALUE IS WHICH CARD IS STILL OUT. Three foundations are
// complete and the fourth is short by its Queen AND its King, so the move under
// test completes it to the Queen: a build that wins on twelve-card foundations,
// on fifty-one cards, or on "no card left on the table but one" all read
// differently from a build that waits for the fifty-second.
//
// AND THE BOARD IS THEN HELD for a second of game time, because a build that
// tests the win in its update rather than on the move would declare it on some
// later frame, not on this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { DECK_SIZE, RANK_MAX, SUITS } from "../constants";
import {
  captureStill,
  card,
  createHarness,
  framesFor,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";

/** The suit whose foundation is short, and which of the four holds it. */
const SHORT_SUIT = "clubs" as const;
const SHORT_FOUNDATION = SUITS.indexOf(SHORT_SUIT);

/**
 * How high that foundation is built before the move: to the Jack.
 *
 * Two cards short of the King, so the move under test lands its Queen and leaves
 * exactly one card — the King — off the foundations. `RANK_MAX - 2` is `11`.
 */
const SHORT_UP_TO = RANK_MAX - 2;

/** Where the two cards still out wait, each alone in its own column. */
const QUEEN_COLUMN = 0;
const KING_COLUMN = 1;

/** The cards home once the move under test has been accepted: fifty-one. */
const CARDS_HOME_AFTER = DECK_SIZE - 1;

/**
 * How long the board is held after that move, in seconds of game time.
 *
 * A second is five and a half launch intervals (`specs/victory.md` fixes
 * `LAUNCH_INTERVAL` at `0.18`), so a build that declared the win a frame late,
 * or on any frame of its update rather than on the move, has had every chance to
 * do so and to launch several cards while it was at it.
 */
const HOLD_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("stays on playing when a move leaves fifty-one cards home", async () => {
  await openTable(h);
  for (const [index, suit] of SUITS.entries()) {
    await poseFoundation(
      h,
      index,
      suit,
      suit === SHORT_SUIT ? SHORT_UP_TO : RANK_MAX,
    );
  }
  await poseColumn(h, QUEEN_COLUMN, [card("QC")]);
  await poseColumn(h, KING_COLUMN, [card("KC")]);

  const before = await h.snapshot();
  assertEqual(
    before.winDetect,
    true,
    "the win-detection gate this check leaves at its reset default, so the " +
      "build's own win test is what decides the screen (specs/instrumentation.md)",
  );
  assertEqual(
    before.foundations.reduce((n, pile) => n + pile.length, 0),
    CARDS_HOME_AFTER - 1,
    "the cards home before the move under test",
  );

  const accepted = await h.debug.move(
    "tableau",
    QUEEN_COLUMN,
    0,
    "foundation",
    SHORT_FOUNDATION,
  );
  // Read on the move itself, which is where the win test runs.
  const onTheMove = await h.snapshot();

  await h.advance(framesFor(HOLD_SECONDS));
  await captureStill(h, "playing");
  const held = await h.snapshot();

  assertEqual(
    accepted,
    true,
    `move's verdict on the Queen of ${SHORT_SUIT} offered to its own ` +
      "foundation, which stands at the Jack (specs/foundations.md)",
  );
  assertEqual(
    onTheMove.foundations.reduce((n, pile) => n + pile.length, 0),
    CARDS_HOME_AFTER,
    "the cards home after the move — fifty-one, with the King still out",
  );
  assertEqual(
    onTheMove.screen,
    "playing",
    "the screen on the move that brought the fifty-first card home — " +
      "specs/victory.md wins on all fifty-two, so one card still out is no win",
  );
  assertEqual(
    held.screen,
    "playing",
    `the screen ${HOLD_SECONDS} s later, with the King of ${SHORT_SUIT} still ` +
      "on the table — a build that tests the win each frame rather than on a " +
      "move would have declared it by now",
  );
  assertEqual(
    held.launched,
    0,
    "cards the cascade has launched — specs/victory.md: the cascade begins " +
      "with the win, and there has been no win",
  );
  assertLength(
    held.flyers,
    0,
    "cards in flight while the game is still being played",
  );
  assertGreaterThan(
    held.tableau[KING_COLUMN].length,
    0,
    `the cards left in column ${KING_COLUMN}, which holds the one card that ` +
      "is not home",
  );
  assertLength(
    held.foundations[SHORT_FOUNDATION],
    RANK_MAX - 1,
    `the cards on foundation ${SHORT_FOUNDATION} — its Queen went home and it ` +
      "is still owed its King, which is the whole of why this is not a win",
  );
});
