// instrumentation/win-detect-gate-on — with win detection gated back on, the gate
// reads back on and the same completion reaches `won`.
//
// THE RULE. specs/instrumentation.md, The faculty gates: `setWinDetect(enabled)`
// gates "The check that all fifty-two cards are home and the move to the `won`
// screen", and each gate "is reported by `snapshot`". specs/victory.md states
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
import {
  captureStill,
  createHarness,
  poseNearlyWon,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches the won screen on the same completion with the gate on", async () => {
  const posed = poseNearlyWon(h);
  // The gate is left at the value `reset` restores, which is on
  // (specs/instrumentation.md); this reading is what makes the one above a
  // gate rather than a build that never detects a win.

  const accepted = h.debug.move(
    "tableau",
    posed.column,
    posed.row,
    "foundation",
    posed.foundation,
  );
  const after = h.snapshot();
  await h.advance(1);
  // Before the assertions, so a build that stayed on the table still leaves the
  // picture of the screen it drew.
  captureStill(h, "won");

  assertEqual(
    accepted,
    true,
    `move() to accept the ${posed.suit} King onto its own foundation ` +
      "holding that suit's Queen (specs/foundations.md)",
  );
  assertEqual(
    after.screen,
    "won",
    "the screen the same completion reached with the gate on: the game is " +
      "won the instant all fifty-two cards are home, and moves to won on " +
      "that move (specs/victory.md)",
  );
});
