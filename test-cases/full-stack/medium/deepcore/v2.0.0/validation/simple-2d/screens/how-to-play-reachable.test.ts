// screens/how-to-play-reachable — the how-to screen is reachable from the title.
//
// specs/ui.md: `HOW TO PLAY` on the title "goes to `how-to-play`". This point
// decides that hop and nothing else.
//
// THE RETURN IS ITS OWN POINT. `screens/how-to-play-back` decides that the screen
// comes back to the title, because a build that opens the screen and traps the
// player on it must grade differently from one that never opens it. The category
// splits every other pair the same way — `title-to-mode-select` beside
// `mode-select-back`, `mode-to-size-select` beside `size-select-back`.
//
// ISOLATION. The title reached directly with the slot cleared, so `HOW TO PLAY`
// is the entry specs/ui.md puts last with no save banked.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** The main menu with no save banked: `TITLE_ITEMS` without its first entry. */
const ITEMS_NO_SAVE = TITLE_ITEMS.slice(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to screen from the title", async () => {
  h.debug.clearSave();
  h.debug.reset();
  h.debug.setScreen("title");

  h.debug.setMenuIndex(ITEMS_NO_SAVE.indexOf("HOW TO PLAY"));
  await h.tap(ACTION_KEY.activate);
  captureStill(h, "howto");

  assertEqual(
    h.snapshot().screen,
    "how-to-play",
    "specs/ui.md: HOW TO PLAY goes to how-to-play",
  );
});
