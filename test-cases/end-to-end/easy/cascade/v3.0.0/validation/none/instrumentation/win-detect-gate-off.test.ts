// instrumentation/win-detect-gate-off — with win detection gated off, the gate
// reads back off and a board completed to fifty-two stays on `playing`.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: `setWinDetect(enabled)`
// gates "The check that all fifty-two cards are home and the move to the `won`
// screen. Off, a board completed to fifty-two stays on `playing`." Each gate "is
// reported by `snapshot`", so the pose and its effect are both read here.
//
// WHY THE OFF DIRECTION IS ITS OWN POINT. A switch that never turns the faculty
// off leaves every scenario that fills the foundations grading a faculty it never
// asked for: the victory cascade takes over the board in the middle of a point
// about something else, and fifty-two cards leave the piles the check was
// reading. That is a different cost from a switch that never turns the check back
// on, which is `instrumentation/win-detect-gate-on`.
//
// NOTHING ABOUT THE WIN IS POSED. Fifty-one cards are placed and the fifty-second
// is sent home by a real `move`, so the build's own win test is what does or does
// not fire, through the same path a released drop uses
// (`specs/instrumentation.md`). The verdict is asserted and the foundations are
// counted, because a move the build refused completed nothing and this point
// would be reading a board that was never finished.
//
// THE SCREEN IS READ BEFORE A FRAME RUNS. `specs/victory.md` starts the launch
// clock full — "so the first card launches on the cascade's first frame" — so a
// completed board is only complete until a frame takes a card off a foundation.
//
// WHAT THIS DOES NOT DECIDE. What the `won` screen SHOWS, which is `screens/*`'s,
// nor that the cascade follows the win, which is
// `winning/cascade-begins-on-win`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DECK_SIZE, SUITS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseNearlyWon,
  type Harness,
} from "../harness";

/** Where the fifty-second card waits, and the suit it belongs to. */
const COLUMN = 0;
const MISSING_SUIT = SUITS[SUITS.length - 1];

/** The foundation that suit's King is sent to, by `poseNearlyWon`'s own layout. */
const FOUNDATION = SUITS.indexOf(MISSING_SUIT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the gate off and holds a completed board on playing", async () => {
  await openTable(h);
  await h.debug.setWinDetect(false);
  await poseNearlyWon(h, {
    suit: MISSING_SUIT,
    at: { pile: "tableau", index: COLUMN },
  });

  assertEqual(
    (await h.snapshot()).winDetect,
    false,
    "snapshot().winDetect after setWinDetect(false): each gate is reported by " +
      "snapshot (specs/instrumentation.md)",
  );

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );
  // Read before a frame runs: with the gate on, the cascade takes its first card
  // off a foundation on the very next one (`specs/victory.md`).
  const after = await h.snapshot();
  const home = after.foundations.reduce((n, pile) => n + pile.length, 0);

  await h.advance(1);
  // Before the assertions, so a win that should not have happened still leaves
  // the picture of the board it took over.
  await captureStill(h, "gated");

  assertEqual(
    accepted,
    true,
    `the verdict move() returned on sending the King of ${MISSING_SUIT} home ` +
      `from column ${COLUMN}, the fifty-second card — a refused move completes ` +
      `nothing`,
  );
  assertEqual(
    home,
    DECK_SIZE,
    "the cards on the four foundations once the last one went home",
  );
  assertEqual(
    after.screen,
    "playing",
    `the screen a board completed to ${DECK_SIZE} reached with ` +
      `setWinDetect(false) — the gate stops the check and the move to the won ` +
      `screen (specs/instrumentation.md)`,
  );
});
