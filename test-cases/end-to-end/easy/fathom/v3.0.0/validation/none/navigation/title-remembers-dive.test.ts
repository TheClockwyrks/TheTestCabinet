// navigation/title-remembers-dive — the title comes back on DIVE after a quit.
//
// The other half of specs/ui.md's remembered title selection, in the direction
// `title-remembers-howto` cannot reach. That point confirms `HOW TO PLAY` and
// reads `1` back; a build that hard-coded `1`, or one that simply never moved a
// selection it had already put there, would pass it. So this one starts with
// `titleIndex` ALREADY carrying `1`, confirms `DIVE`, and reads `0` back: the
// restored selection follows the entry confirmed rather than a constant.
//
// THE STARTING VALUE IS POSED WITH `setTitleIndex`, the one operation
// specs/instrumentation.md gives for the remembered selection, rather than walked
// to by confirming `HOW TO PLAY` and coming back. That walk is the route
// `states.howto-reachable` and `states.howto-return-back` decide, so a build with
// a broken how-to screen would lose this point for their fault rather than its
// own.
//
// THE RETURN IS THE QUIT PATH, the third of the three specs/ui.md names, so
// between the two points every path back to the title is covered once. That the
// quit reaches the title at all is `navigation.pause-quit`'s.
//
// Every selection is posed with `setMenuIndex` rather than walked with the arrow
// keys (specs/instrumentation.md). Nothing advances on `"title"`, `"howto"` or
// `"paused"` (specs/ui.md), so no bystander can move under the scenario.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

/** The title's entries, by index (specs/ui.md, `TITLE_ITEMS`). */
const DIVE = TITLE_ITEMS.indexOf("DIVE");
const HOWTO = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** The pause menu's entries, by index (specs/ui.md, `PAUSE_ITEMS`). */
const QUIT = PAUSE_ITEMS.indexOf("QUIT TO MENU");

/** The key specs/movement.md binds `confirm` to first: it takes a menu item. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("records DIVE over a remembered HOW TO PLAY and lands on it after a quit", async () => {
  // A non-zero starting `titleIndex`, posed in one call.
  await openTitle(h);
  await h.debug.setTitleIndex(HOWTO);
  const opening = await h.snapshot();
  assertEqual(
    opening.titleIndex,
    HOWTO,
    "the remembered title selection this point starts from, posed with " +
      "`setTitleIndex` (specs/instrumentation.md)",
  );

  await h.debug.setMenuIndex(DIVE);
  await h.tap(CONFIRM_KEY);
  const dived = await h.snapshot();
  assertEqual(dived.screen, "countdown", "the screen DIVE confirmed reaches");
  assertEqual(
    dived.titleIndex,
    DIVE,
    "the title menu's remembered selection after DIVE was confirmed there, " +
      "which replaces the entry it held (specs/ui.md)",
  );

  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(QUIT);
  await h.tap(CONFIRM_KEY);
  const title = await h.snapshot();
  // Before the assertions, so a failing check still leaves the screen it read.
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "the screen the quit reached");
  assertEqual(
    title.menuIndex,
    DIVE,
    "the title's selection on the return, which every arrival takes from " +
      "`titleIndex` (specs/ui.md)",
  );
});
