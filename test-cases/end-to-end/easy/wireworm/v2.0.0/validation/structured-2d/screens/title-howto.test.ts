// Wireworm — screens/title-howto: confirming HOW TO PLAY on the title opens the
// how-to screen.
//
// One transition of the menu state machine `specs/ui.md` fixes: HOW TO PLAY
// "moves to `howto`". The highlight is POSED onto the second item with the
// surface's own `setMenuIndex` rather than walked there with the movement keys,
// so what this decides is the transition alone: whether `down` moves a highlight
// is `screens/title-menu-wraps-down`'s to decide, and a build with a stuck
// highlight and a working confirm grades differently here from one with neither.
//
// The press itself is the `confirm` action's own bound key, dispatched as a real
// key event at the target the engine listens on — the menus are keyboard only
// (`specs/controls.md`).

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to screen from the second title item", async () => {
  resetTo(h);
  assertEqual(
    TITLE_ITEMS[1],
    "HOW TO PLAY",
    "HOW TO PLAY is the second title item",
  );
  h.debug.setMenuIndex(1);
  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the press is made on the title screen");
  assertEqual(
    posed.menuIndex,
    1,
    "setMenuIndex rests the highlight on HOW TO PLAY " +
      "(specs/instrumentation.md)",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "confirming HOW TO PLAY leaves the game on the howto screen (specs/ui.md)",
  );
});
