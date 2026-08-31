// Shatter — screens/title-menu-entries: the title menu draws both of its entries,
// the first above the second.
//
// THE RULE. `specs/ui.md` gives the `title` screen the menu `TITLE_ITEMS` — `PLAY`,
// `HOW TO PLAY`, "in that order" — and states that "the menu's entries are stacked
// one above the next under the title and tagline". Order on a vertical menu is
// position: the first entry is drawn above the second, so the reading is each
// entry's own `y` on the frame the build drew.
//
// AN ENTRY IS FOUND BY ITS COPY, AT THE PLACE THE TRANSFORM PUT IT. `entryDraw`
// (`./menu.ts`) maps every run of text through whatever transform was in force at
// the call, so a menu drawn under a translate is read where it lands rather than
// where its call named. `PLAY` is a substring of `HOW TO PLAY`, so the two are
// separated by handing the whole menu in: a run holding the longer entry is the
// longer entry's.
//
// THE FRAME IS PRESENTED, NOT STEPPED, so nothing of the screen's own timing runs
// under the reading.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the title and tagline are drawn
// (`screens/title-shows-the-title`), which entry is highlighted
// (`screens/title-menu-highlight`), or where either entry leads
// (`screens/play-starts-a-game`, `screens/howto-reachable`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { menuDraws } from "./menu";
import { reachTitle } from "./screens";

/** The entries `specs/ui.md` gives the title menu, which this item's reading rests on. */
const MENU_ENTRIES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws PLAY above HOW TO PLAY on the title menu", async () => {
  assertEqual(
    TITLE_ITEMS.length,
    MENU_ENTRIES,
    "the title menu entries specs/ui.md fixes, which this item's reading rests on",
  );

  await reachTitle(h);

  const calls = await h.presentCalls();
  await captureStill(h, "menu");

  const drawn = menuDraws(calls, TITLE_ITEMS, "the title screen");
  assertLessThan(
    drawn[0].y,
    drawn[1].y,
    `"${TITLE_ITEMS[0]}" is drawn above "${TITLE_ITEMS[1]}" (specs/ui.md)`,
  );
});
