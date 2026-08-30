// instrumentation/win-detect-gate — with win detection gated off, a board
// completed to fifty-two stays on `playing`; with the gate on, the same
// completion reaches `won`.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: `setWinDetect(enabled)`
// gates "The check that all fifty-two cards are home and the move to the `won`
// screen. Off, a board completed to fifty-two stays on `playing`."
// `specs/victory.md` states the faculty: "The game is won the instant all
// `DECK_SIZE` (`52`) cards are on the foundations ... and the game moves to the
// `won` screen on that move."
//
// WHY IT IS ITS OWN POINT. The gate is what lets a scenario fill the foundations
// without the victory cascade taking over the board — every check that reads a
// nearly-complete table depends on it — and a build that ignores it would launch
// fifty-two cards into the middle of a point about something else.
//
// THE SAME COMPLETION IS DRIVEN TWICE, ONCE UNDER EACH SETTING, on the same board
// posed twice, so nothing separates the two runs but the gate. A build with a
// working gate and no win test at all fails the second run; a build that wins
// whatever the gate says fails the first. One direction alone could not tell them
// apart.
//
// NOTHING ABOUT THE WIN IS POSED. Fifty-one cards are placed and the fifty-second
// is sent home by a real `move`, so the build's own win test is what does or does
// not fire, through the same path a released drop uses
// (`specs/instrumentation.md`). Both verdicts are asserted and the foundations
// are counted, because a move the build refused completed nothing and this point
// would be reading a board that was never finished.
//
// THE SCREEN IS READ BEFORE A FRAME RUNS. `specs/victory.md` starts the launch
// clock full — "so the first card launches on the cascade's first frame" — so the
// gated run's foundations are only complete until a frame takes a card off one.
//
// WHAT THIS DOES NOT DECIDE. What the `won` screen SHOWS, which is `screens/*`'s,
// nor that the cascade follows the win, which is `winning/cascade-begins-on-win`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DECK_SIZE, SUITS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseNearlyWon,
  type Harness,
  type Screen,
} from "../harness";

/** Where the fifty-second card waits, and the suit it belongs to. */
const COLUMN = 0;
const MISSING_SUIT = SUITS[SUITS.length - 1];

/** The foundation that suit's King is sent to, by `poseNearlyWon`'s own layout. */
const FOUNDATION = SUITS.indexOf(MISSING_SUIT);

/** What one run of the completion reported. */
interface Completion {
  accepted: boolean;
  home: number;
  screen: Screen;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a completed board on playing with the gate off and wins with it on", async () => {
  /** Pose fifty-one cards home, set the gate, send the last one, and read. */
  const run = async (winDetect: boolean): Promise<Completion> => {
    // `openTable` resets, so each run starts from the gates' own defaults and
    // from a table with nothing else on it.
    await openTable(h);
    await h.debug.setWinDetect(winDetect);
    await poseNearlyWon(h, {
      suit: MISSING_SUIT,
      at: { pile: "tableau", index: COLUMN },
    });

    const accepted = await h.debug.move(
      "tableau",
      COLUMN,
      0,
      "foundation",
      FOUNDATION,
    );
    // Read before a frame runs: with the gate on, the cascade takes its first
    // card off a foundation on the very next one (`specs/victory.md`).
    const after = await h.snapshot();
    return {
      accepted,
      home: after.foundations.reduce((n, pile) => n + pile.length, 0),
      screen: after.screen,
    };
  };

  const gated = await run(false);
  await h.advance(1);
  // Before the assertions and before the second run, so a failing gate still
  // leaves the picture of the completed board it was supposed to hold.
  await captureStill(h, "gated");

  const open = await run(true);

  for (const [name, result] of [
    ["with setWinDetect(false)", gated],
    ["with setWinDetect(true)", open],
  ] as const) {
    assertEqual(
      result.accepted,
      true,
      `the verdict move() returned ${name} on sending the King of ` +
        `${MISSING_SUIT} home from column ${COLUMN}, the fifty-second card — ` +
        `a refused move completes nothing`,
    );
    assertEqual(
      result.home,
      DECK_SIZE,
      `the cards on the four foundations ${name}, once the last one went home`,
    );
  }

  assertEqual(
    gated.screen,
    "playing",
    `the screen a board completed to ${DECK_SIZE} reached with ` +
      `setWinDetect(false) — the gate stops the check and the move to the ` +
      `won screen (specs/instrumentation.md)`,
  );
  assertEqual(
    open.screen,
    "won",
    `the screen the same completion reached with setWinDetect(true) — the ` +
      `game is won the instant all ${DECK_SIZE} cards are home ` +
      `(specs/victory.md), so a build that never wins fails here rather than ` +
      `passing on a gate it ignores`,
  );
});
