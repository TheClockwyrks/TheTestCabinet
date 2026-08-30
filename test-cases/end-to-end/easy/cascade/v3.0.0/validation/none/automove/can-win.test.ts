// automove/can-win — auto-moving the fifty-second card home reaches the `won`
// screen.
//
// `specs/victory.md`: "The game is won the instant all `DECK_SIZE` (`52`) cards
// are on the foundations ... The win is reached by whatever move put the last
// card home, whether a released drop or a double click, and the game moves to the
// `won` screen on that move." `specs/controls.md` says the same of the gesture
// the auto-move serves: "Sending a card home this way is a move like any other,
// so it turns a newly exposed column card and it can win the game."
//
// NOTHING ABOUT THE ENDING IS POSED. Fifty-one cards are placed and the
// fifty-second is sent by the operation under test, so the build's own win test
// is what moves the screen. `setWinDetect` is left ON at its reset default and
// asserted so: the gate is `instrumentation/win-detect-gate`'s to grade.
//
// THE READING IS TAKEN BEFORE A FRAME RUNS. `specs/victory.md` starts the launch
// clock full — "so the first card launches on the cascade's first frame" — so the
// foundations are only complete until the cascade takes a card off one. The
// still is captured after half a second of the cascade instead, so a reviewer
// sees a game being WON rather than a static board; the assertions read the
// snapshot taken before it, and nothing that half second does can change them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
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
import { FOUNDATION_COUNT, RANK_MAX } from "../constants";

/** Where the one card left out is put: alone, face-up, in a column. */
const COLUMN = 0;

/** The suit kept out. Its foundation stands at the Queen and is owed the King. */
const MISSING_SUIT = "clubs" as const;

/**
 * How much of the cascade the captured still shows, in seconds.
 *
 * Evidence only, and driven AFTER the reading the assertions use. Half a second
 * is `floor(0.5 / LAUNCH_INTERVAL) + 1` = 3 cards launched by `specs/victory.md`'s
 * cadence: enough that the picture reads as a won game with its cascade under
 * way, rather than as a board that merely happens to be complete.
 */
const AFTERMATH_SECONDS = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("wins the game when it sends the fifty-second card home", async () => {
  await openTable(h);
  const kingId = await poseNearlyWon(h, {
    suit: MISSING_SUIT,
    at: { pile: "tableau", index: COLUMN },
  });

  const posed = await h.snapshot();
  assertEqual(
    posed.winDetect,
    true,
    "the win-detection gate this check leaves on",
  );
  assertEqual(posed.screen, "playing", "the screen before the last card goes");
  assertEqual(
    posed.foundations.reduce((n, pile) => n + pile.length, 0),
    RANK_MAX * FOUNDATION_COUNT - 1,
    "the cards home before the last card goes",
  );

  const went = await h.debug.autoMove("tableau", COLUMN);
  // Read before a frame runs: the cascade launches its first card on the very
  // next one (`specs/victory.md`).
  const after = await h.snapshot();
  await h.advance(framesFor(AFTERMATH_SECONDS));
  await captureStill(h, "won");

  assertEqual(went, true, "the verdict autoMove returned");
  assertEqual(after.screen, "won", "the screen the last card home reached");
  assertEqual(
    whereIs(after, kingId)?.pile,
    "foundation",
    "where the fifty-second card ended up",
  );
  for (let i = 0; i < FOUNDATION_COUNT; i += 1) {
    assertLength(
      pileOf(after, "foundation", i),
      RANK_MAX,
      `the cards on foundation ${i} once the game is won`,
    );
  }
  assertLength(
    pileOf(after, "tableau", COLUMN),
    0,
    "the cards left in the column",
  );
});
