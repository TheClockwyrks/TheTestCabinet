// panels/end-screen-menu-items-are-clickable — the two end screens answer a press.
//
// `specs/controls.md`: "A pointer is pressed and released inside one menu item's
// region: that item becomes the highlighted item and is chosen, exactly as
// `activate` chooses it." `specs/ui.md` gives the Victory and Game Over screens a
// menu each, and both carry `MENU`, which goes to `title`. This point presses that
// entry at the region the build reports for it, on each of the two screens.
//
// WHERE EACH ONE IS. `specs/overview.md` hands the layout to the build, so
// nothing here knows where anything is drawn — it asks. `specs/instrumentation.md`
// declares `menuItemRect(index)` and `controlRect(control, subject)`, each
// reporting "the region a pointer or a touch contact drives that item or that
// control from", and `panels/mouse.ts` aims at the middle of the region the BUILD
// named. Nothing searches the screen.
//
// ONE SURFACE PER POINT. Every menu a screen shows and every named control in
// `specs/instrumentation.md`'s `controlRect` table has a point of its own, so a
// build where one of them ignores the pointer grades differently from a build
// where none of them answers. The menus are `panels/menu-items-are-clickable`,
// `panels/pause-menu-items-are-clickable` and
// `panels/end-screen-menu-items-are-clickable`; the controls are the
// `*-is-clickable` points beside this one, plus `audio/mute-control-toggles`.

import { afterEach, beforeEach, it } from "vitest";
import { GAME_OVER_ITEMS, VICTORY_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { driveDeath, driveVictory } from "../screens/expedition";
import { clickMenuItem } from "./mouse";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the victory and game-over menus", async () => {
  await driveVictory(h);
  await clickMenuItem(h, VICTORY_ITEMS.indexOf("MENU"));
  await h.advance(1);
  const fromVictory = h.snapshot().screen;

  openScene(h);
  h.debug.clearSave();
  pinMiner(h);
  pinDrill(h);
  await driveDeath(h, "hull-destroyed");
  await clickMenuItem(h, GAME_OVER_ITEMS.indexOf("MENU"));
  await h.advance(1);
  captureStill(h, "end");
  const fromGameOver = h.snapshot().screen;

  assertEqual(
    fromVictory,
    "title",
    "specs/ui.md: MENU on the Victory screen, pressed at its region, goes to the title",
  );
  assertEqual(
    fromGameOver,
    "title",
    "specs/ui.md: MENU on the Game Over screen, pressed at its region, goes to the title",
  );
});
