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
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseNearlyWon,
  tableCards,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose a board one card short of a win with the gate as given, and send it home. */
function completeWithGate(winDetect: boolean): void {
  openTable(h);
  h.debug.setWinDetect(winDetect);
  const pending = poseNearlyWon(h);

  const accepted = h.debug.move(
    pending.from.pile,
    pending.from.index,
    pending.from.row,
    "foundation",
    pending.foundation,
  );
  assertEqual(
    accepted,
    true,
    "move must accept the last card of a suit onto that suit's foundation " +
      "(specs/foundations.md)",
  );
  assertLength(
    tableCards(h.snapshot()),
    DECK_SIZE,
    "the cards on the table once the last one has been sent home",
  );
}

it("reaches the won screen with the gate on", async () => {
  completeWithGate(true);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertion, so a build that stayed on the table still leaves the
  // picture of the screen it drew.
  captureStill(h, "won");

  assertEqual(
    after.screen,
    "won",
    "the screen a board completed to fifty-two reaches with winDetect on: " +
      "the game is won the instant every card is home (specs/victory.md)",
  );
});
