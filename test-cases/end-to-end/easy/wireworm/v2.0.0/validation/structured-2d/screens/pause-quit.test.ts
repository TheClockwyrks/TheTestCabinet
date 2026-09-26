// Wireworm — screens/pause-quit: confirming QUIT TO MENU returns to the title.
//
// One transition of the menu state machine `specs/ui.md` fixes: QUIT TO MENU
// "Returns to `title`". WHICH ENTRY the title comes back on is
// `screens/pause-quit-selects-descend`'s point, not this one: a build that
// reaches the title on the wrong entry still reaches it, and the two must grade
// apart.
//
// The highlight is posed onto the third pause item with `setMenuIndex`, so what
// this decides is the transition rather than how a menu moves.
//
// The pause is raised by the `pause` action's own first bound key (`KeyP`) over
// live, active play, and the accept is the `confirm` action's, both dispatched
// as real key events at the target the engine listens on.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
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

it("returns to the title from the third pause item", async () => {
  resetTo(h);
  startPlaying(h);

  await tapAction(h, "pause");
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the pause key opens the pause screen during live play (specs/ui.md)",
  );
  assertEqual(
    PAUSE_ITEMS[2],
    "QUIT TO MENU",
    "QUIT TO MENU is the third pause item",
  );
  h.debug.setMenuIndex(2);
  assertEqual(
    h.snapshot().menuIndex,
    2,
    "the pause menu's highlight rests on QUIT TO MENU before the confirm",
  );

  await tapAction(h, "confirm");
  await h.advance(1);
  captureStill(h, "title");

  const title = h.snapshot();
  assertEqual(
    title.screen,
    "title",
    "confirming QUIT TO MENU leaves the game on the title (specs/ui.md)",
  );
});
