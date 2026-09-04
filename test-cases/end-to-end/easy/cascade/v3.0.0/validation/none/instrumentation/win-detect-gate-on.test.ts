// instrumentation/win-detect-gate-on — with win detection gated back on, the gate
// reads back on and the same completion reaches `won`.
//
// THE RULE. `specs/instrumentation.md`, The faculty gates: `setWinDetect(enabled)`
// gates "The check that all fifty-two cards are home and the move to the `won`
// screen", and each gate "is reported by `snapshot`". `specs/victory.md` states
// the faculty: "The game is won the instant all `DECK_SIZE` (`52`) cards are on
// the foundations ... and the game moves to the `won` screen on that move."
//
// WHY THE ON DIRECTION IS ITS OWN POINT, AND WHY IT TURNS THE GATE OFF FIRST. A
// switch that never turns the check back on leaves the win itself dead in normal
// play — a player finishes the game and nothing happens — which costs something
// completely different from a switch that never turns it off
// (`instrumentation/win-detect-gate-off`). Setting the gate to `true` from
// `false` rather than reading the default is what makes this a reading of the
// SWITCH: a build that ignores the operation entirely and always wins would
// otherwise pass on a value it never honoured.
//
// NOTHING ABOUT THE WIN IS POSED. Fifty-one cards are placed and the fifty-second
// is sent home by a real `move`, so it is the build's own win test that fires.
// The verdict is asserted and the foundations are counted, because a move the
// build refused completed nothing.
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

it("reports the gate on again and wins on the same completion", async () => {
  await openTable(h);
  // Off and then on, so what is read is the operation rather than a default.
  await h.debug.setWinDetect(false);
  await h.debug.setWinDetect(true);
  await poseNearlyWon(h, {
    suit: MISSING_SUIT,
    at: { pile: "tableau", index: COLUMN },
  });

  assertEqual(
    (await h.snapshot()).winDetect,
    true,
    "snapshot().winDetect after setWinDetect(true) followed " +
      "setWinDetect(false): each gate is reported by snapshot " +
      "(specs/instrumentation.md)",
  );

  const accepted = await h.debug.move(
    "tableau",
    COLUMN,
    0,
    "foundation",
    FOUNDATION,
  );
  // Read before a frame runs: the cascade takes its first card off a foundation
  // on the very next one (`specs/victory.md`).
  const after = await h.snapshot();
  const home = after.foundations.reduce((n, pile) => n + pile.length, 0);

  await h.advance(1);
  await captureStill(h, "won");

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
    "won",
    `the screen the completion reached with setWinDetect(true) — the game is ` +
      `won the instant all ${DECK_SIZE} cards are home (specs/victory.md), so ` +
      `a build that never wins fails here rather than passing on a gate it ` +
      `ignores`,
  );
});
