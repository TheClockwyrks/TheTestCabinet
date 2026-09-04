// screens/hud-menu-returns — the HUD's MENU returns to the title.
//
// specs/screens.md gives the HUD's second control its job: "`MENU` — Returns to
// `title`." specs/controls.md fixes the rectangle it answers, `HUD_MENU` at
// `{ x: 420, y: 680, w: 120, h: 36 }`, and states that a click activates the
// control whose hit rectangle contains its press point. specs/victory.md leans on
// it too: a game with no legal move left is simply unwinnable, and "a player
// leaves such a game through the controls `specs/screens.md` states".
//
// ONE DIRECTION, AND NOTHING ELSE. What this decides is that the control leaves
// the table for the title. The HUD's other two controls are
// `screens/hud-new-game-deals` and `screens/hud-sound-toggles`, so a build with
// one working control and one broken one grades apart from one with both broken.
//
// THE TABLE IS EMPTY: the control belongs to the `playing` screen and owes
// nothing to what is on the table (specs/screens.md), so a deal would only put a
// broken deal between this point and the transition it reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_MENU } from "../constants";
import {
  captureStill,
  clickControl,
  createHarness,
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

it("reaches the title screen when the HUD's MENU is clicked", async () => {
  openTable(h);
  assertEqual(
    h.snapshot().screen,
    "playing",
    "posing: the live table, which is the screen the HUD's controls belong to " +
      "(specs/screens.md)",
  );

  clickControl(h, HUD_MENU);
  await h.advance(1);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen a click inside HUD_MENU reaches (specs/screens.md)",
  );
});
