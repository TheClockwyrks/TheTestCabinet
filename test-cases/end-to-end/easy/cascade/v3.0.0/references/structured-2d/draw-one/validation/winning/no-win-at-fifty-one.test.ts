// winning/no-win-at-fifty-one — fifty-one cards home is not a win.
//
// THE RULE, IN ITS OTHER DIRECTION. specs/victory.md wins the game "the instant all
// `DECK_SIZE` (`52`) cards are on the foundations, each foundation complete from
// its Ace to its King". A board one card short meets neither half of that, so it is
// still live play: "A game with no legal move left is simply unwinnable. There is
// no loss condition and no timer", and the screen stays `playing`
// (specs/screens.md).
//
// `winning/win-at-fifty-two` decides that fifty-two wins. This point decides that
// fifty-one does not, and the two are separate because a build that wins early and
// a build that never wins are different faults with different fixes, and each has
// to grade on its own.
//
// THE WIN TEST IS RUN, NOT AVOIDED. A board simply POSED at fifty-one would let a
// build that never checks anything pass by doing nothing. So the fifty-first card
// is sent home through `move`, which specs/instrumentation.md says "applies through
// the same path a released drop uses, so ... a completed board wins". The build's
// win test therefore runs, on a board of fifty-one, and has to answer no.
//
// THE BOARD IS POSED SO EVERY WRONG TEST READS DIFFERENTLY. Three foundations are
// complete Ace to King and the fourth is built to its Jack; that suit's Queen is
// sent home during the check and its King is left on a column of its own. So at the
// moment the win test runs:
//
//   - a test that counts the cards home sees 51, not 52;
//   - a test satisfied by ANY complete foundation sees three of them;
//   - a test satisfied by "the top of every foundation is a King" sees a Queen;
//   - a test that asks whether the tableau is empty sees the King still on it.
//
// A build that answers yes to any of those wins here and fails, and the value it
// read names which wrong test it implemented.
//
// EVERY FRAME IS SAMPLED, not just the last. `until` reads the screen after every
// frame of the watch, so a build that wins one frame late — or flashes the won
// screen and returns to play — is caught at the frame it strayed on rather than
// being missed by a reading taken only at the end. The gates are left exactly as
// `openTable` leaves them, which is all four on: this is the board a player would
// be sitting in front of, and `winDetect` is the faculty the requirement exercises.

import { afterEach, beforeEach, it } from "vitest";
import { DECK_SIZE, RANK_MAX } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  ALL_SUITS,
  card,
  captureStill,
  cardsHome,
  createHarness,
  framesFor,
  KING,
  openTable,
  poseColumn,
  poseFoundation,
  QUEEN,
  type Harness,
} from "../harness";

/**
 * The rank the incomplete foundation is built to before the check moves a card
 * onto it: two below the King, so the Queen is the card sent home and the King is
 * the fifty-second card left out of the game.
 */
const BUILT_TO = RANK_MAX - 2;

/** The suit whose foundation is left short, and the slot it is built on. */
const SHORT_FOUNDATION = 0;
const SHORT_SUIT = ALL_SUITS[SHORT_FOUNDATION];

/** The columns that suit's last two cards wait on, one card each. */
const FIFTY_FIRST_COLUMN = 0;
const FIFTY_SECOND_COLUMN = 1;

/**
 * How long the board is watched after the fifty-first card lands, in frames.
 *
 * A whole second of game time, sampled every frame. specs/victory.md wins on the
 * move rather than on a clock, so a conformant build's answer is settled before the
 * first of these frames runs; the watch is here for the build that tests for the
 * win somewhere in its update instead, and a second is far longer than any period
 * this case names — the longest, `DOUBLE_CLICK_WINDOW`, is `0.30` s.
 */
const WATCH_FRAMES = framesFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stays on the playing screen when the fifty-first card goes home", async () => {
  openTable(h);
  ALL_SUITS.forEach((suit, slot) => {
    poseFoundation(
      h,
      slot,
      suit,
      slot === SHORT_FOUNDATION ? BUILT_TO : RANK_MAX,
    );
  });
  poseColumn(h, FIFTY_FIRST_COLUMN, [card(SHORT_SUIT, QUEEN)]);
  poseColumn(h, FIFTY_SECOND_COLUMN, [card(SHORT_SUIT, KING)]);

  const posed = h.snapshot();
  assertEqual(
    cardsHome(posed),
    DECK_SIZE - 2,
    `cards on the foundations with the ${SHORT_SUIT} Queen and King still on ` +
      "the table (specs/victory.md)",
  );

  const accepted = h.debug.move(
    "tableau",
    FIFTY_FIRST_COLUMN,
    0,
    "foundation",
    SHORT_FOUNDATION,
  );
  assertEqual(
    accepted,
    true,
    `move() to accept the ${SHORT_SUIT} Queen onto that suit's foundation ` +
      "built to its Jack, which is the move this point runs the win test with " +
      "(specs/foundations.md)",
  );

  const landed = h.snapshot();
  assertEqual(
    cardsHome(landed),
    DECK_SIZE - 1,
    "cards on the foundations after that move, which is one short of the " +
      "fifty-two a win takes (specs/victory.md)",
  );

  const watched = await h.until((seen) => seen.screen !== "playing", {
    maxFrames: WATCH_FRAMES,
  });

  captureStill(h, "playing");

  assertEqual(
    watched.snapshot.screen,
    "playing",
    `the screen over ${String(WATCH_FRAMES)} frames with fifty-one cards home ` +
      `and the ${SHORT_SUIT} King still out, which is not a win ` +
      "(specs/victory.md)",
  );
});
