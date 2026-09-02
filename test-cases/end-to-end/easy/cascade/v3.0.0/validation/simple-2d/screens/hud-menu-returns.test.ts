// screens/hud-menu-returns — the HUD's MENU returns the player to the title.
//
// THE RULE. specs/screens.md's HUD table: `HUD_ITEMS[1]`, `MENU`, in the
// `HUD_MENU` rectangle, "returns to `title`". specs/controls.md fixes that
// rectangle as `{ x: 420, y: 680, w: 120, h: 36 }` and states that a control
// answers a CLICK whose press point lies inside it.
//
// ONE REQUIREMENT, IN ONE DIRECTION: that the click LEAVES play for the title. It
// is the player's way out of a game with no legal move left, which is why
// specs/victory.md names the controls specs/screens.md states as the way out of an
// unwinnable game.
//
// DRIVEN THROUGH THE ENGINE'S OWN POINTER, at the rectangle's center, so what is
// exercised is the player's path.
//
// THE TABLE IS EMPTY under the HUD. Nothing this point reads concerns a card, and
// `openTable` is the isolated live table the suite stands on.
//
// WHAT THIS DOES NOT DECIDE. That the `MENU` label is drawn in its rectangle,
// which is `presentation/hud-labels-drawn`, nor what the title screen shows once
// it is reached, which is the four `title-shows-*` points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_MENU } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  tapPointer,
  type Harness,
} from "../harness";

/** A point inside `HUD_MENU`: its center (specs/controls.md). */
const PRESS = {
  x: HUD_MENU.x + HUD_MENU.w / 2,
  y: HUD_MENU.y + HUD_MENU.h / 2,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches the title screen when the HUD's MENU is clicked", async () => {
  openTable(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the game is in live play, where HUD_MENU answers " +
      "(specs/controls.md: a control answers only on the screen it belongs to)",
  );

  await tapPointer(h, PRESS.x, PRESS.y);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen after a click inside HUD_MENU (specs/screens.md)",
  );
});
