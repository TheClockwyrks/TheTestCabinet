// screens/howto-reachable — confirming HOW TO PLAY opens the how-to screen.
//
// THE RULE. `specs/ui.md` gives the title menu's second entry, `TITLE_ITEMS[1]`
// (`HOW TO PLAY`), one job: "moves to `howto`". `specs/instrumentation.md` reports
// which of the five screens is showing as `screen`, so the reading is that field
// after the entry is taken.
//
// WHY THE SECOND ENTRY AND NOT THE FIRST. The two entries lead to two different
// screens, so posing the highlight on the second is what separates a build that
// reads the highlight from one that hard-wired the title's confirm to the first
// entry: the wrong model lands on `playing` rather than on `howto`, and the
// failure names the screen it reached. The highlight is posed with `setMenuIndex`
// rather than driven there with a key, because `specs/ui.md` fixes the ORDER of
// the entries but not which one the title opens on, and because the key that moves
// a highlight is the `controls` group's item, not this one's.
//
// THE PRESS IS A REAL ONE, at the target the engine listens on, through a key
// `specs/controls.md` binds to `confirm`. That is the whole of what "confirming"
// means here; nothing about the screen it leaves is posed.
//
// WHAT THIS ITEM DOES NOT DECIDE. What the how-to screen SAYS, which is
// `screens/howto-shows-the-controls`, nor how a player gets back off it, which is
// `screens/howto-returns`.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, keyFor, type Harness } from "../harness";

/** The entry `specs/ui.md` fixes as the title menu's second: the one taken here. */
const HOW_TO_PLAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves to the how-to screen when the second title entry is confirmed", async () => {
  assertEqual(
    TITLE_ITEMS[HOW_TO_PLAY],
    "HOW TO PLAY",
    "the second entry of the title menu specs/ui.md fixes",
  );

  h.debug.reset();
  h.debug.setMenuIndex(HOW_TO_PLAY);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the screen the entry was taken from");
  assertEqual(
    posed.menuIndex,
    HOW_TO_PLAY,
    "the entry the highlight was posed on",
  );

  await h.tap(keyFor("confirm"));
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen confirming HOW TO PLAY moves to (specs/ui.md)",
  );
});
