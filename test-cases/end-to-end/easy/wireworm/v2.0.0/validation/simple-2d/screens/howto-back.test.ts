// Wireworm — screens/howto-back: `back` on the how-to screen returns to the
// title, with the title's highlight at the first item.
//
// One transition of the menu state machine `specs/ui.md` fixes: on `howto`,
// "`back` returns to `title`, with the title's highlight at the first item". The
// screen is POSED with the surface's own `setScreen` rather than reached through
// the title menu, so what this decides is the return alone: whether confirming
// HOW TO PLAY opens the screen is `screens/title-howto`'s to decide, and a build
// that cannot open the how-to screen and one that cannot leave it grade
// differently.
//
// The highlight is posed AWAY from the first item before the press, so "with the
// title's highlight at the first item" is a reading of what the return did
// rather than of what `reset` had already left behind.
//
// The press is the `back` action's own bound key — `Escape`, which also drives
// `pause`, so the build has to resolve it as the back on a screen showing no
// live play (`specs/controls.md`) — dispatched as a real key event at the target
// the engine listens on.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** `back`'s own bound key (specs/controls.md). */
const BACK_KEY = "Escape";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns from the how-to screen to the title at its first item", async () => {
  h.debug.reset();
  h.debug.setMenuIndex(TITLE_ITEMS.length - 1);
  h.debug.setScreen("howto");
  assertEqual(
    h.snapshot().screen,
    "howto",
    "setScreen poses the how-to screen (specs/instrumentation.md)",
  );

  await h.tap(BACK_KEY);
  await h.advance(1);
  captureStill(h, "title");

  const returned = h.snapshot();
  assertEqual(
    returned.screen,
    "title",
    "back on the how-to screen returns to the title (specs/ui.md)",
  );
  assertEqual(
    returned.menuIndex,
    0,
    "the title's highlight is back at its first item (specs/ui.md)",
  );
});
