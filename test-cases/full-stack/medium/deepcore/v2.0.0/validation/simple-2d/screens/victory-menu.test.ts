// screens/victory-menu — MENU leaves the Victory screen for the title.
//
// specs/ui.md, on the Victory screen's menu: `MENU` "goes to `title`". A player
// who has just won is not stranded on the screen that told them so.
//
// THE OTHER ENTRY IS ITS OWN POINT. `screens/victory-play-again` decides
// `PLAY AGAIN`, and `screens/victory-screen` decides what the screen draws, the
// way the pause menu's three entries are three points.
//
// ISOLATION. A Hardcore expedition at the Quick size, driven to the Victory
// screen through the shared `driveVictory`; nothing but the one menu choice is
// pressed once it is there.

import { afterEach, beforeEach, it } from "vitest";
import { VICTORY_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { driveVictory } from "./expedition";

/** Settings a session never opens at, so "the same" is a real reading. */
const MODE = "hardcore" as const;
const SIZE = "quick" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title", async () => {
  await driveVictory(h, { mode: MODE, size: SIZE });

  h.debug.setMenuIndex(VICTORY_ITEMS.indexOf("MENU"));
  await h.tap(ACTION_KEY.activate);
  await h.advance(1);
  captureStill(h, "menu");

  assertEqual(
    h.snapshot().screen,
    "title",
    "specs/ui.md: MENU on the Victory screen goes to the title",
  );
});
