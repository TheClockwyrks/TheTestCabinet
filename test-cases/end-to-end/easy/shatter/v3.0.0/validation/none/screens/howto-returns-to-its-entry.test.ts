// Shatter — screens/howto-returns-to-its-entry: the return from the how-to screen
// lands on the entry that opened it.
//
// THE RULE. `specs/ui.md`, on `title`: "The highlight rests on the first entry
// when the game opens and on every return from a game... a return from `howto`
// puts the highlight back on `HOW TO PLAY`, the entry that opened that screen."
// The `howto` section states the mechanism: "the title's highlight is left exactly
// as it was while this screen shows". `specs/ui.md` fixes `TITLE_ITEMS` as `PLAY`,
// `HOW TO PLAY` in that order, so the entry that opens the how-to is index `1`.
//
// WHY IT MATTERS. A player who opens the instructions and comes back finds the
// highlight where they left it rather than one entry above, so pressing confirm
// twice does not start a game they did not ask for.
//
// THE SCREEN IS REACHED THROUGH THE TITLE, WHICH IS THE POINT. Every other check
// in this group poses `howto` with `setScreen`, which never touches the title menu
// and would leave the index this check reads undefined. Here the how-to is opened
// the way a player opens it: the highlight is addressed with `setMenuIndex` — the
// direct route, and the one that does not lean on the move bindings
// `controls/menu-down-arrow` and its siblings grade — and the entry is confirmed
// with a real key, because `specs/instrumentation.md` carries no operation that
// takes a menu entry.
//
// WHAT THIS ITEM DOES NOT DECIDE. That confirming `HOW TO PLAY` opens the screen
// (`screens/howto-reachable`) or that leaving it reaches the title at all
// (`screens/howto-returns`). Both are asserted here only as the preconditions this
// check cannot proceed without, and both name what they needed when they fail.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY_BACK, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { SETTLE_TICKS, confirmEntry, reachTitle } from "./screens";

/** The title entry that opens the how-to screen (`specs/ui.md`). */
const HOW_TO_PLAY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("comes back to the HOW TO PLAY entry the how-to was opened from", async () => {
  assertEqual(
    TITLE_ITEMS[HOW_TO_PLAY],
    "HOW TO PLAY",
    "the title entry specs/ui.md puts second",
  );

  await reachTitle(h);
  await confirmEntry(h, HOW_TO_PLAY);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen confirming HOW TO PLAY opened",
  );

  await h.tap(KEY_BACK);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "title");

  const back = await h.snapshot();
  assertEqual(
    back.screen,
    "title",
    "the screen leaving the how-to returned to",
  );
  assertEqual(
    back.menuIndex,
    HOW_TO_PLAY,
    "the title entry highlighted on the return from the how-to (specs/ui.md)",
  );
});
