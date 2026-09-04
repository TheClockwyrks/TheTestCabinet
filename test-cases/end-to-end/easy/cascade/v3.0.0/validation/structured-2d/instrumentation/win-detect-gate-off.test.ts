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
import { assertEqual } from "../assert";
import { DECK_SIZE } from "../constants";
import {
  captureStill,
  cardsHome,
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

it("leaves a completed board on the playing screen with the gate off", async () => {
  // Every foundation complete but one, its King waiting on an otherwise empty
  // table, one legal move from winning.
  const posed = poseNearlyWon(h);
  h.debug.setWinDetect(false);

  const accepted = h.debug.move(
    "tableau",
    posed.column,
    posed.row,
    "foundation",
    posed.foundation,
  );
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "gated");

  assertEqual(
    accepted,
    true,
    `move() to accept the ${posed.suit} King onto its own foundation ` +
      "holding that suit's Queen (specs/foundations.md)",
  );
  assertEqual(
    cardsHome(after),
    DECK_SIZE,
    "cards on the four foundations once the last one was moved home",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen a board completed to fifty-two reached with " +
      "setWinDetect(false): off, it stays on playing " +
      "(specs/instrumentation.md)",
  );
});
