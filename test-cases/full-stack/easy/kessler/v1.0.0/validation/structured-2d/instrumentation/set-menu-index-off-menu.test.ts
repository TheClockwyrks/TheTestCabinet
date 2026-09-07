// instrumentation/set-menu-index-off-menu — the pose fails loudly off a menu.
//
// specs/instrumentation.md, `setMenuIndex(n)`: "A screen carrying no menu has
// no entry to highlight, so the call fails loudly there rather than passing
// quietly." specs/screens.md fixes what stands instead: "On a screen with no
// menu `menu.index` rests at `0`."
//
// THE EDGE CASE IS ITS OWN VALIDATOR. Each of the four menu-free screens is the
// same edge exercised the same way, so they share this one; that the pose WORKS
// on a menu-bearing screen is `set-menu-index`. The whole snapshot bar the
// screen is compared beside the thrown error, so a build that swallowed the
// call and one that acted on it are both caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertFailsLoudly } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { MENU_FREE_SCREENS } from "./helpers";

/** An index a two-entry menu would accept, so only the screen decides this. */
const POSED = 1;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fails loudly on a screen carrying no menu, changing nothing", async () => {
  h.debug.reset();
  for (const screen of MENU_FREE_SCREENS) {
    h.debug.setScreen(screen);
    const before = h.snapshot();
    assertEqual(before.menu.index, 0, `${screen}: the highlight at rest`);
    await assertFailsLoudly(
      () => h.debug.setMenuIndex(POSED),
      `${screen}: setMenuIndex on a screen carrying no menu`,
    );
    const after = h.snapshot();
    assertDeepEqual(after, before, `${screen}: the state across the call`);
  }
  captureStill(h, "unchanged");
});
