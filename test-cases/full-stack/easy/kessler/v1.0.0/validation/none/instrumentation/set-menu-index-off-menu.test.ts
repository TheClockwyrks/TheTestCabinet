// instrumentation/set-menu-index-off-menu — the pose does nothing off a menu.
//
// specs/instrumentation.md, `setMenuIndex(n)`: "On a screen with no menu the
// call changes nothing." specs/screens.md fixes what that leaves standing: "On
// a screen with no menu `menu.index` rests at `0`."
//
// THE EDGE CASE IS ITS OWN VALIDATOR. Each of the four menu-free screens is the
// same edge exercised the same way, so they share this one; that the pose WORKS
// on a menu-bearing screen is `set-menu-index`. The whole snapshot bar the
// screen is compared, so "changes nothing" is read over the state rather than
// over `menu.index` alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { MENU_FREE_SCREENS } from "./helpers";

/** An index a two-entry menu would accept, so only the screen decides this. */
const POSED = 1;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("changes nothing on a screen carrying no menu", async () => {
  await h.debug.reset();
  for (const screen of MENU_FREE_SCREENS) {
    await h.debug.setScreen(screen);
    const before = await h.snapshot();
    assertEqual(before.menu.index, 0, `${screen}: the highlight at rest`);
    await h.debug.setMenuIndex(POSED);
    const after = await h.snapshot();
    assertDeepEqual(after, before, `${screen}: the state across the call`);
  }
  await captureStill(h, "unchanged");
});
