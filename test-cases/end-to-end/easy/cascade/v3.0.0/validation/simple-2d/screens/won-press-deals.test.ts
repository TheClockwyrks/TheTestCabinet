// screens/won-press-deals — a press on the won screen starts the next game.
//
// THE RULE. specs/screens.md's `won` section: "A press deals a fresh game and
// returns to `playing`, as specs/victory.md states." specs/victory.md is
// unambiguous about when: "A press anywhere, during the cascade or after it, deals
// a fresh game and moves to the `playing` screen." specs/controls.md says the same
// from the pointer's side: "on `won` a press deals a fresh game".
//
// SO THE SCREEN IS POSED AND THE PRESS IS IMMEDIATE. `setScreen("won")` puts the
// game on the screen this point is about and changes nothing else
// (specs/instrumentation.md), and the specification asks for a press ANYWHERE,
// during the cascade or after it, so a posed `won` screen is a screen a
// conforming build answers. Running a whole cascade out first would fold
// `screens/won-shows-message`'s requirement into this verdict and buy the reading
// nothing.
//
// THE PRESS LANDS ON BARE TABLE, well left of column zero's anchor at `x = 224`
// and far above the HUD strip at `y = 680` (specs/table.md), so the point carries
// no pile and no control on either the screen it is pressed on or the screen it
// reaches. What answers it is the `won` screen's own rule and nothing else.
//
// THE TABLE IS EMPTIED FIRST, which is what makes the deck reading mean anything:
// with no card on the thirteen piles before the press, `DECK_SIZE` (`52`)
// afterwards can only have come from a deal (specs/deal.md). The count is the
// whole of what is read of the deal here — its columns, faces and shares are the
// `deal` group's eleven points, and that the deal clears the painted table is
// `deal/deal-clears-trail`.
//
// WHAT THIS DOES NOT DECIDE. That the message is drawn, which is
// `screens/won-shows-message`, nor that the game reaches `won` in the first place,
// which is `winning/win-at-fifty-two`.

import { afterEach, beforeEach, it } from "vitest";
import { DECK_SIZE } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  tableCards,
  tapPointer,
  type Harness,
} from "../harness";

/**
 * Where the press lands: bare table.
 *
 * `x = 60` is well left of `COLUMN_X[0]` (`224`) and of `STOCK_X` (`224`), and
 * `y = 400` is well above the HUD strip at `HUD_Y` (`680`), so no pile's drop
 * rectangle and no control's hit rectangle contains it (specs/table.md,
 * specs/controls.md).
 */
const PRESS = { x: 60, y: 400 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals a full deck and returns to playing when the won screen is pressed", async () => {
  openTable(h);
  h.debug.setScreen("won");
  assertEqual(
    h.snapshot().screen,
    "won",
    "posing: the game is on the won screen, where a press deals " +
      "(specs/victory.md)",
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
  assertEqual(
    snapshot.screen,
    "playing",
    "the screen after a press on the won screen (specs/victory.md, " +
      "specs/screens.md)",
  );
  assertLength(
    tableCards(snapshot),
    DECK_SIZE,
    "cards on the thirteen piles after that press, which specs/deal.md fixes " +
      "at DECK_SIZE (52) for a fresh deal (specs/victory.md)",
  );
});
