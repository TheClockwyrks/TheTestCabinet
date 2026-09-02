// screens/title-new-game-enters-play — the title's NEW GAME deals a game and
// enters play.
//
// THE RULE. specs/screens.md's title table: `NEW GAME` "deals a fresh game, as
// specs/deal.md states, and moves to `playing`". specs/controls.md fixes its hit
// rectangle as `TITLE_NEW_GAME` (`{ x: 480, y: 448, w: 320, h: 52 }`) and states
// that a control answers a CLICK — a press and the release that follows it within
// `DRAG_THRESHOLD` — whose press point lies inside that rectangle.
//
// DRIVEN THROUGH THE ENGINE'S OWN POINTER. {@link tapPointer} dispatches a real
// press and release at the rectangle's center and runs the one frame that delivers
// both, so what is exercised is the player's path: the same events, read by the
// same update. The point is the rectangle's center, which is the least
// interesting point inside it — this decides that the control answers, not where
// its edges are.
//
// THE TABLE IS EMPTIED FIRST, which is what makes the second reading mean
// anything: with no card on the thirteen piles before the press, fifty-two
// afterwards can only have come from a deal. `DECK_SIZE` (`52`) is
// specs/deal.md's, and the count is the whole of what is read of the deal here —
// the column sizes, the faces, the stock's share and the empty waste are the
// `deal` group's eleven points, and grading them again here would grade one deal
// twice.
//
// WHAT THIS DOES NOT DECIDE. That `NEW GAME` is DRAWN on the title screen, which
// is `screens/title-shows-items`, nor that the HUD's own `NEW GAME` deals, which
// is `screens/hud-new-game-deals`: a build whose title control is dead and whose
// HUD control works fails one point and passes the other.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE, TITLE_NEW_GAME } from "../constants";
import {
  captureStill,
  createHarness,
  tableCards,
  tapPointer,
  type Harness,
} from "../harness";

/** A point inside `TITLE_NEW_GAME`: its center (specs/controls.md). */
const PRESS = {
  x: TITLE_NEW_GAME.x + TITLE_NEW_GAME.w / 2,
  y: TITLE_NEW_GAME.y + TITLE_NEW_GAME.h / 2,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches playing with a full deck dealt when NEW GAME is clicked", async () => {
  h.debug.setScreen("title");
  h.debug.clearTable();
  assertEqual(
    h.snapshot().screen,
    "title",
    "posing: the game is on the title screen, where TITLE_NEW_GAME answers " +
      "(specs/controls.md: a control answers only on the screen it belongs to)",
  );
  assertLength(
    tableCards(h.snapshot()),
    0,
    "posing: cards on the thirteen piles before the press, so the deck below " +
      "can only have come from the deal (specs/instrumentation.md)",
  );

  await tapPointer(h, PRESS.x, PRESS.y);
  captureStill(h, "playing");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "playing",
    "the screen after a click inside TITLE_NEW_GAME (specs/screens.md)",
  );
  assertLength(
    tableCards(snapshot),
    DECK_SIZE,
    "cards on the thirteen piles after that click, which specs/deal.md fixes " +
      "at DECK_SIZE (52) for a fresh deal (specs/screens.md)",
  );
});
