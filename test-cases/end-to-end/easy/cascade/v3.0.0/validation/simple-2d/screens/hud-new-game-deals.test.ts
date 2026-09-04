// screens/hud-new-game-deals — the HUD's NEW GAME deals a fresh game and leaves
// the player in it.
//
// THE RULE. specs/screens.md's HUD table: `HUD_ITEMS[0]`, `NEW GAME`, in the
// `HUD_NEW_GAME` rectangle, "deals a fresh game and stays on `playing`".
// specs/controls.md fixes that rectangle as
// `{ x: 224, y: 680, w: 180, h: 36 }` and states that a control answers a CLICK
// whose press point lies inside it.
//
// BOTH HALVES ARE ONE REQUIREMENT, and the second is what separates this control
// from the title's: a build that answered the HUD's `NEW GAME` by returning to the
// title and dealing there has not done what the HUD asks. So the screen is read as
// well as the deck.
//
// THE TABLE IS EMPTIED FIRST, which is what makes the deck reading mean anything:
// with no card on the thirteen piles before the press, `DECK_SIZE` (`52`)
// afterwards can only have come from a deal (specs/deal.md). The count is the
// whole of what is read of the deal here — its columns, faces and shares are the
// `deal` group's eleven points.
//
// DRIVEN THROUGH THE ENGINE'S OWN POINTER, at the rectangle's center, so what is
// exercised is the player's path: a real press and release, read by one update.
//
// WHAT THIS DOES NOT DECIDE. That the `NEW GAME` label is drawn in its rectangle,
// which is `presentation/hud-labels-drawn`, nor that the TITLE's `NEW GAME` deals,
// which is `screens/title-new-game-enters-play`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE, HUD_NEW_GAME } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  tableCards,
  tapPointer,
  type Harness,
} from "../harness";

/** A point inside `HUD_NEW_GAME`: its center (specs/controls.md). */
const PRESS = {
  x: HUD_NEW_GAME.x + HUD_NEW_GAME.w / 2,
  y: HUD_NEW_GAME.y + HUD_NEW_GAME.h / 2,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals a full deck and stays on playing when the HUD's NEW GAME is clicked", async () => {
  openTable(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the game is in live play, where HUD_NEW_GAME answers " +
      "(specs/controls.md: a control answers only on the screen it belongs to)",
  );
  assertLength(
    tableCards(h.snapshot()),
    0,
    "posing: cards on the thirteen piles before the press, so the deck below " +
      "can only have come from the deal (specs/instrumentation.md)",
  );

  await tapPointer(h, PRESS.x, PRESS.y);
  captureStill(h, "dealt");

  const snapshot = h.snapshot();
  assertLength(
    tableCards(snapshot),
    DECK_SIZE,
    "cards on the thirteen piles after a click inside HUD_NEW_GAME, which " +
      "specs/deal.md fixes at DECK_SIZE (52) for a fresh deal " +
      "(specs/screens.md)",
  );
  assertEqual(
    snapshot.screen,
    "playing",
    "the screen after that click, which specs/screens.md leaves on playing",
  );
});
