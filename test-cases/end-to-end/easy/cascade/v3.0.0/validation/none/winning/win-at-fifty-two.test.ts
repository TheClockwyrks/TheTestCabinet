// winning/win-at-fifty-two — fifty-two cards home wins the game, on the move that
// put the last one there.
//
// `specs/victory.md`, The win: "The game is won the instant all `DECK_SIZE`
// (`52`) cards are on the foundations, each foundation complete from its Ace to
// its King. The win is reached by whatever move put the last card home ... and
// the game moves to the `won` screen on that move."
//
// THE MOVE IS THE SUBJECT, NOT THE GESTURE THAT ISSUED IT. `winning/win-by-drop`
// and `winning/win-by-double-click` are the two gestures; this point is the rule
// underneath both, so the last card is sent by `move()`, the operation
// `specs/instrumentation.md` says "applies through the same path a released drop
// uses, so ... a completed board wins".
//
// NOTHING ABOUT THE ENDING IS POSED. Fifty-one cards are placed and the
// fifty-second is carried home by the game's own move rules, so the build's own
// win test is what moves the screen. `setWinDetect` is left ON at its reset
// default and asserted so, because the gate itself is
// `instrumentation/win-detect-gate-off`'s to grade and a check that quietly ran with
// it off would decide nothing.
//
// THE READING IS TAKEN BEFORE A FRAME RUNS. `specs/victory.md` starts the launch
// clock full, "so the first card launches on the cascade's first frame", and a
// launched card leaves its foundation — so the foundations are complete only
// until the cascade takes one off. The still is captured after half a second of
// cascade instead, so a reviewer sees a game being won rather than a static
// board; nothing that half second does can reach the snapshot the assertions
// read.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { DECK_SIZE, FOUNDATION_COUNT, RANK_MAX, SUITS } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  openTable,
  pileOf,
  poseNearlyWon,
  whereIs,
  type Harness,
} from "../harness";

/** The column the one card kept out of the foundations waits on, alone. */
const COLUMN = 0;

/** The suit kept out. Its foundation stands at the Queen and is owed the King. */
const MISSING_SUIT = "clubs" as const;

/**
 * The foundation that suit's cards are on, which is the one the last card is
 * sent to.
 *
 * `poseNearlyWon` gives foundation `i` the suit `SUITS[i]`, a choice
 * `specs/foundations.md` leaves open and `foundations/any-suit-any-slot` grades.
 */
const FOUNDATION = SUITS.indexOf(MISSING_SUIT);

/**
 * Where the King lands on its foundation, counted from the bottom.
 *
 * A foundation builds up in order from its Ace (`specs/foundations.md`), so the
 * King is the thirteenth card and its row is `RANK_MAX - 1`.
 */
const KING_ROW = RANK_MAX - 1;

/**
 * How much of the cascade the captured still shows, in seconds.
 *
 * Evidence only, and driven AFTER the reading the assertions use. Half a second
 * is `floor(0.5 / LAUNCH_INTERVAL) + 1` = 3 cards launched by
 * `specs/victory.md`'s cadence: enough that the picture reads as a won game with
 * its ending under way rather than as a board that merely happens to be
 * complete.
 */
const AFTERMATH_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("becomes won on the move that puts the fifty-second card home", async () => {
  await openTable(h);
  const kingId = await poseNearlyWon(h, {
    suit: MISSING_SUIT,
    at: { pile: "tableau", index: COLUMN },
  });

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
  assertEqual(
    before.foundations.reduce((n, pile) => n + pile.length, 0),
    DECK_SIZE - 1,
    "the cards home before the last one is sent",
  );

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );
  // Read before a frame runs: the cascade launches its first card on the very
  // next one and a launched card leaves its foundation (specs/victory.md).
  const after = await h.snapshot();

  await h.advance(framesFor(AFTERMATH_SECONDS));
  await captureStill(h, "won");

  assertEqual(
    accepted,
    true,
    `move's verdict on the King of ${MISSING_SUIT} offered to its own ` +
      "foundation, which stands at the Queen (specs/foundations.md)",
  );
  assertEqual(
    after.screen,
    "won",
    "the screen the instant the fifty-second card landed — specs/victory.md: " +
      "the game moves to the won screen on the move that put the last card home",
  );
  assertDeepEqual(
    whereIs(after, kingId),
    { pile: "foundation", index: FOUNDATION, row: KING_ROW },
    `where the King of ${MISSING_SUIT} (id ${kingId}) sits after the move`,
  );
  assertEqual(
    after.foundations.reduce((n, pile) => n + pile.length, 0),
    DECK_SIZE,
    "the cards home once the game is won",
  );
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    assertLength(
      pileOf(after, "foundation", i),
      RANK_MAX,
      `the cards on foundation ${i} — specs/victory.md wins on every ` +
        "foundation being complete from its Ace to its King",
    );
  }
});
