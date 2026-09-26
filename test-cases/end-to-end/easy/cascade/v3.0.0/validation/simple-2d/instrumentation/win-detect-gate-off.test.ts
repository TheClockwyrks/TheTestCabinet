// instrumentation/win-detect-gate-off — with win detection gated off, the gate
// reads back off and a board completed to fifty-two stays on `playing`.
//
// THE RULE. specs/instrumentation.md, The faculty gates: `setWinDetect(enabled)`
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
// (specs/instrumentation.md). The verdict is asserted and the foundations are
// counted, because a move the build refused completed nothing and this point
// would be reading a board that was never finished.
//
// THE SCREEN IS READ BEFORE A FRAME RUNS. specs/victory.md starts the launch
// clock full — "so the first card launches on the cascade's first frame" — so a
// completed board is only complete until a frame takes a card off a foundation.
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

it("stays on the playing screen with the gate off", async () => {
  completeWithGate(false);
  const after = h.snapshot();

  // The completed board still on the playing screen.
  await h.advance(1);
  captureStill(h, "gated");

  assertEqual(
    after.screen,
    "playing",
    "the screen a board completed to fifty-two reaches with " +
      "setWinDetect(false) (specs/instrumentation.md)",
  );
  assertLength(
    after.foundations.flat(),
    DECK_SIZE,
    "the cards on the foundations, which are all fifty-two",
  );
});
