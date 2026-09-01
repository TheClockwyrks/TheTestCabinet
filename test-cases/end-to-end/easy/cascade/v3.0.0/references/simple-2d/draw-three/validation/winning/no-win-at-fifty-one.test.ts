// winning/no-win-at-fifty-one — fifty-one cards home is not a win.
//
// THE RULE, IN ITS OTHER DIRECTION. specs/victory.md wins the game "the instant all
// `DECK_SIZE` (`52`) cards are on the foundations, each foundation complete from
// its Ace to its King". A board one card short meets neither half of that, so it is
// still live play: "A game with no legal move left is simply unwinnable. There is
// no loss condition", and the screen stays `playing` (specs/screens.md).
//
// `winning/win-at-fifty-two` decides that fifty-two wins. This point decides that
// fifty-one does not, and the two are separate because a build that wins early and
// a build that never wins are different faults with different fixes, and each has
// to grade on its own.
//
// THE WIN TEST IS RUN, NOT AVOIDED. A board simply POSED at fifty-one would let a
// build that never checks anything pass by doing nothing. So the fifty-first card
// is sent home through `move`, which is the path specs/instrumentation.md says
// "applies through the same path a released drop uses, so ... a completed board
// wins". The build's win test therefore runs, on a board of fifty-one, and has to
// answer no.
//
// THE BOARD IS POSED SO EVERY WRONG TEST READS DIFFERENTLY. Three foundations are
// complete Ace to King and the fourth is built to the Jack; the Queen of that suit
// is sent home during the check and the King is left on a column. So at the moment
// the win test runs:
//
//   - a test that counts cards home sees 51, not 52;
//   - a test satisfied by ANY complete foundation sees three of them;
//   - a test satisfied by "the top of every foundation is a King" sees a Queen;
//   - a test that asks whether the tableau is empty sees the King still on it.
//
// A build that answers yes to any of those wins here and fails, and the value it
// read names which wrong test it implemented.
//
// EVERY FRAME IS SAMPLED, not just the last. `until` reads the screen after every
// frame of the watch, so a build that wins one frame late — or flashes the won
// screen and returns — is caught at the frame it strayed on rather than being
// missed by a reading taken only at the end. The gates are left exactly as
// `openTable` leaves them, which is all four on: this is the board a player would
// be sitting in front of, and `winDetect` is the faculty the requirement exercises.

import { afterEach, beforeEach, it } from "vitest";
import { DECK_SIZE, RANK_MAX, SUITS } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";

/**
 * The rank the incomplete foundation is built to before the check moves a card
 * onto it: two below the King, so the Queen is the card sent home and the King is
 * the fifty-second card left out of the game.
 */
const BUILT_TO = RANK_MAX - 2;

/** The suit whose foundation is left short, and the slot it is built on. */
const SHORT_SUIT = SUITS[0];
const SHORT_FOUNDATION = 0;

/** The two cards of that suit the pose keeps off its foundation. */
const FIFTY_FIRST = "QS";
const FIFTY_SECOND = "KS";

/** The columns those two wait on. */
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

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("stays on the playing screen when the fifty-first card goes home", async () => {
  openTable(harness);
  for (const [slot, suit] of SUITS.entries()) {
    poseFoundation(
      harness,
      slot,
      suit,
      slot === SHORT_FOUNDATION ? BUILT_TO : RANK_MAX,
    );
  }
  poseColumn(harness, FIFTY_FIRST_COLUMN, [FIFTY_FIRST]);
  poseColumn(harness, FIFTY_SECOND_COLUMN, [FIFTY_SECOND]);

  const posed = harness.snapshot();
  assertLength(
    posed.foundations.flat(),
    DECK_SIZE - 2,
    `cards on the foundations with the ${FIFTY_FIRST} and the ` +
      `${FIFTY_SECOND} still on the table (specs/victory.md)`,
  );

  const accepted = harness.debug.move(
    "tableau",
    FIFTY_FIRST_COLUMN,
    0,
    "foundation",
    SHORT_FOUNDATION,
  );
  assertEqual(
    accepted,
    true,
    `move() to accept the ${FIFTY_FIRST} onto the ${SHORT_SUIT} foundation ` +
      "built to the Jack, which is the move this point runs the win test with " +
      "(specs/foundations.md)",
  );

  const landed = harness.snapshot();
  assertLength(
    landed.foundations.flat(),
    DECK_SIZE - 1,
    "cards on the foundations after that move, which is one short of the " +
      "fifty-two a win takes (specs/victory.md)",
  );

  const watched = await harness.until((seen) => seen.screen !== "playing", {
    maxFrames: WATCH_FRAMES,
  });

  captureStill(harness, "playing");

  assertEqual(
    watched.snapshot.screen,
    "playing",
    `the screen over ${String(WATCH_FRAMES)} frames with fifty-one cards home ` +
      `and the ${FIFTY_SECOND} still out, which is not a win ` +
      "(specs/victory.md)",
  );
});
