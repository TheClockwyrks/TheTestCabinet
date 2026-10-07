// Shatter — screens/quit-returns-to-the-play-entry: quitting a match puts the
// title's highlight back on the entry that started it.
//
// THE RULE. `specs/ui.md`, on `paused`: `QUIT TO MENU` "Returns to `title`, with
// the title's highlight on `PLAY`, the entry that led away into the match", and on
// `title`: "The highlight rests on the first entry when the game opens and on every
// return from a game, where `PLAY` is the entry that led away". `TITLE_ITEMS` is
// `PLAY`, `HOW TO PLAY` in that order, so the entry is index `0`.
//
// WHY IT IS A POINT OF ITS OWN. `screens/quit-returns-to-the-title` decides the
// SCREEN. A build that lands on the title with the highlight left wherever the
// pause menu had it must grade differently from one that gets both right, so the
// highlight is read here and nowhere else. `screens/howto-returns-to-its-entry` is
// the same rule read on the other return, where the answer is the other entry.
//
// AND THE READING IS NOT VACUOUS. The pause menu's highlight is posed on entry `2`,
// `QUIT TO MENU`, so a build that simply carried its menu index across the
// transition reports `2` here, and one that never touched the title's index since
// the game opened reports `0` only because it never moved — which is why the check
// takes a real match through a real pause rather than posing `title` outright.
//
// THE ENTRY IS ADDRESSED, NOT COUNTED. `setMenuIndex(2)` places the highlight
// directly; counting presses onto it would grade `controls/menu-down-arrow` a
// second time. The confirm is a real key, because `specs/instrumentation.md`
// carries no operation that takes a menu entry.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { SETTLE_TICKS, confirmEntry, reachPaused } from "./screens";

/** The pause menu's third entry, `QUIT TO MENU` (`specs/ui.md`). */
const QUIT_ENTRY = 2;

/** The title entry that leads away into a match (`specs/ui.md`). */
const PLAY_ENTRY = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("comes back to the PLAY entry the match was started from", async () => {
  assertEqual(
    PAUSE_ITEMS[QUIT_ENTRY],
    "QUIT TO MENU",
    "the pause menu's third entry, which specs/ui.md fixes",
  );
  assertEqual(
    TITLE_ITEMS[PLAY_ENTRY],
    "PLAY",
    "the title entry specs/ui.md puts first",
  );

  await startPlaying(h);
  await reachPaused(h);
  await confirmEntry(h, QUIT_ENTRY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).menuIndex,
    PLAY_ENTRY,
    "the title entry highlighted on the return from a quit (specs/ui.md)",
  );
});
