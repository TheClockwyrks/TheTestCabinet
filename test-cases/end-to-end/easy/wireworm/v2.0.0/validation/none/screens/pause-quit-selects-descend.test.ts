// Wireworm — screens/pause-quit-selects-descend: quitting a run lands on
// DESCEND.
//
// specs/ui.md's `paused` menu: `QUIT TO MENU` "Returns to `title`, with the
// title's highlight on `DESCEND`". A return selects the entry that led away from
// the menu, and `DESCEND` is the entry a run is started from, so a player who
// quits comes back to the entry they left through.
//
// `screens/pause-quit` DECIDES THE TRANSITION and this decides the selection.
// They are separate points because a build that reaches the title on the wrong
// entry still reaches it, and must grade differently from one that cannot leave
// the pause menu at all.
//
// THE INDEX IS DERIVED FROM `TITLE_ITEMS`, never written as a literal: what
// specs/ui.md fixes is the ENTRY, and the position it sits at is a fact of the
// menu's order.
//
// THE HIGHLIGHT IS NOWHERE NEAR IT WHEN THE CONFIRM RUNS. `menuIndex` is the
// highlight of whichever menu the current screen shows (specs/state.md), so on
// `paused` it rests on `QUIT TO MENU`'s own index — the third entry, not the
// first — and a build that simply left `menuIndex` alone across the transition
// would land the title's highlight off the end of `TITLE_ITEMS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { CONFIRM_KEY, pauseLiveBoard } from "./screens";

/** Which entry of `PAUSE_ITEMS` is `QUIT TO MENU`. */
const QUIT_ITEM = PAUSE_ITEMS.indexOf("QUIT TO MENU");

/** The title entry a run is started from, and so the one a quit returns to. */
const DESCEND_ITEM = TITLE_ITEMS.indexOf("DESCEND");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to the title with DESCEND selected", async () => {
  await startPlaying(h);
  await pauseLiveBoard(h, QUIT_ITEM);

  await h.tap(CONFIRM_KEY);
  await h.advance(1);
  await captureStill(h, "title");

  const returned = await h.snapshot();
  assertEqual(returned.screen, "title", "the screen QUIT TO MENU returned to");
  assertEqual(
    returned.menuIndex,
    DESCEND_ITEM,
    "the title entry the quit selects (specs/ui.md)",
  );
});
