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
import { assertEqual } from "../assert";
import { TITLE_ITEMS_NO_SAVE } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen from the title", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();
  await h.debug.setScreen("title");

  await h.debug.setMenuIndex(TITLE_ITEMS_NO_SAVE.indexOf("HOW TO PLAY"));
  await h.tap(ACTION_KEY.activate);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "how-to-play",
    "specs/ui.md: HOW TO PLAY goes to how-to-play",
  );
});
