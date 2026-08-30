// screens/how-to-play-reachable — the how-to screen is reachable from the title,
// and it comes back.
//
// specs/ui.md: `HOW TO PLAY` on the title "goes to `how-to-play`", and the
// how-to-play screen "Returns to `title`". It is the one screen the file lists
// with no menu items of its own, so what returns from it is the build's choice
// between the two keys specs/controls.md gives a menu screen: `activate`, which
// chooses whatever the screen offers, and `pause`, which goes back where a screen
// has a back. Both are conformant, so the check accepts either — what it decides
// is that the screen is reached and that it returns.
//
// ISOLATION. The title reached directly with the slot cleared, so `HOW TO PLAY`
// is the entry specs/ui.md puts last with no save banked.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
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

it("opens the how-to screen from the title and returns from it", async () => {
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

  await h.tap(ACTION_KEY.activate);
  if (h.snapshot().screen !== "title") await h.tap(ACTION_KEY.pause);

  assertEqual(
    h.snapshot().screen,
    "title",
    "specs/ui.md: the how-to-play screen returns to the title",
  );
});
