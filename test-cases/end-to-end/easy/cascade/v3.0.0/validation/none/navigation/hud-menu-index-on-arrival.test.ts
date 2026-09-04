// navigation/hud-menu-index-on-arrival — a deal that begins play opens the HUD
// on its first item.
//
// THE RULE. `specs/screens.md`, the HUD: "The three are the HUD's menu, in that
// order. Every deal that begins play selects the first of them, so `menuIndex`
// is `0` when a fresh game starts."
//
// WHY THE ROUTE IS THE `won` SCREEN'S PRESS AND NOT EITHER `NEW GAME` CONTROL.
// `specs/controls.md` already has a press and the release that follows it inside
// one item's region set `menuIndex` to that item's index, and both `NEW GAME`
// items are their own menu's item `0`. A click on either therefore leaves
// `menuIndex` at `0` whether or not the build carries the arrival rule at all, so
// a check driven that way passes every build that answers the mouse and grades
// nothing. `specs/victory.md` gives the one route into `playing` that touches no
// item's region: "A press anywhere, during the cascade or after it, deals a fresh
// game and moves to the `playing` screen."
//
// THE SELECTION IS MOVED AWAY FIRST, on `playing`, whose menu it belongs to, and
// carried onto `won` by `setScreen`, which "changes no other field"
// (`specs/instrumentation.md`). So the value read back afterwards is one the
// arrival had to overwrite, and a build that never touches `menuIndex` on a deal
// fails here.
//
// THE PRESS LANDS AT THE CENTRE OF THE STAGE, clear of the HUD strip
// `specs/table.md` fixes, so the release that follows the deal falls inside no
// control's region and nothing but the arrival can have set what is read.
//
// WHAT THIS DOES NOT DECIDE. What the deal lays out, which is `deal/`'s, nor
// that the selected item is drawn distinctly, which is
// `presentation/selected-item-distinct`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_ITEMS, HUD_NEW_GAME_ITEM, STAGE_H, STAGE_W } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

/** The selection the HUD is left on before the deal that has to move it. */
const HUD_AWAY = HUD_ITEMS.length - 1;

/** The centre of the stage, which lies on no control's region on any screen. */
const PRESS_X = STAGE_W / 2;
const PRESS_Y = STAGE_H / 2;

/** One frame, so the canvas carries the HUD the still shows. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects the HUD's first item when a deal begins play", async () => {
  await openTable(h);
  await h.debug.setMenuIndex(HUD_AWAY);
  await h.debug.setScreen("won");

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "won",
    "posing: the screen the press is made on, which is the one route into " +
      "playing that lands on no item's region (specs/victory.md)",
  );
  assertEqual(
    posed.menuIndex,
    HUD_AWAY,
    "posing: the selection carried onto won, which the arrival has to move — " +
      "setScreen changes no other field (specs/instrumentation.md)",
  );

  await clickAt(h, PRESS_X, PRESS_Y);
  await h.advance(SETTLE_FRAMES);
  const arrived = await h.snapshot();

  // Before the assertions, so a HUD that opened on the wrong item still leaves
  // the picture it drew.
  await captureStill(h, "hud");

  assertEqual(
    arrived.screen,
    "playing",
    "the screen the press on won reached — a press anywhere deals a fresh " +
      "game and moves to playing (specs/victory.md)",
  );
  assertEqual(
    arrived.menuIndex,
    HUD_NEW_GAME_ITEM,
    `menuIndex once the deal began play, against the ${HUD_AWAY} the ` +
      `selection was left on — every deal that begins play selects the first ` +
      `of the HUD's items (specs/screens.md)`,
  );
});
