// screens/hud-new-game-deals — the HUD's NEW GAME deals a fresh game.
//
// specs/screens.md gives the HUD's first control its job: "`NEW GAME` — Deals a
// fresh game and stays on `playing`." specs/controls.md fixes the rectangle it
// answers, `HUD_NEW_GAME` at `{ x: 224, y: 680, w: 180, h: 36 }`, and states that
// a click activates the control whose hit rectangle contains its press point.
//
// THE TWO READINGS ARE ONE REQUIREMENT: this control starts another game without
// leaving the table. The deal alone would pass a build that deals and drops the
// player back on the title screen, and the screen alone would pass one that
// leaves the table exactly as it was. The title screen's own `NEW GAME` is
// `screens/title-new-game-enters-play`, so a build that answers one and not the
// other grades apart from one that answers neither.
//
// THE TABLE IS EMPTY BEFORE THE CLICK — `openTable` poses live play with all
// thirteen piles cleared (specs/instrumentation.md) — so the fifty-two cards read
// afterwards are the ones this click dealt. WHAT the deal puts where is the
// `deal` group's requirement; this point asks only that a full deck reached the
// table.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DECK_SIZE, HUD_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  everyCard,
  menuPoint,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals a full deck and stays in play when the HUD's NEW GAME is clicked", async () => {
  openTable(h);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "playing",
    "posing: the live table, which is the screen the HUD's controls belong to " +
      "(specs/screens.md)",
  );
  assertEqual(
    everyCard(before).length,
    0,
    "posing: cards on the table before the click, so the deck read after it " +
      "is this control's own deal (specs/instrumentation.md)",
  );

  // The middle of the region the build reports for the HUD's NEW GAME item.
  clickAt(
    h,
    menuPoint(h, HUD_NEW_GAME_ITEM).x,
    menuPoint(h, HUD_NEW_GAME_ITEM).y,
  );
  await h.advance(1);
  captureStill(h, "dealt");

  const dealt = h.snapshot();
  assertEqual(
    everyCard(dealt).length,
    DECK_SIZE,
    "the cards on the table after a click inside the region the build reports for it, which deals a " +
      "fresh game (specs/screens.md, specs/deal.md)",
  );
  assertEqual(
    dealt.screen,
    "playing",
    "the screen after that click, which deals without leaving the table " +
      "(specs/screens.md)",
  );
});
