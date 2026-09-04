// Facet — targets/targets-reported: every screen reports the pointer targets
// specs/controls.md names for it, under those ids and in that order.
//
// specs/controls.md gives the table outright: `title` carries `menu-0` and
// `menu-1`, "one per entry of `TITLE_ITEMS`"; `howto` carries `back`; `playing`
// carries `pause`; and `paused`, `levelclear` and `gameover` each carry `menu-0`
// and `menu-1`, one per entry of their own item lists.
// specs/instrumentation.md's snapshot shape says where they are read: "`targets`
// lists the current screen's pointer targets, under the ids and in the order
// `specs/controls.md` fixes for that screen."
//
// THIS IS THE POINT EVERY OTHER ONE IN THE CATEGORY RESTS ON, which is what the
// `broken` cap says. A target's RECTANGLE is the build's to design — the case
// fixes not one of them — so every geometry point here reads the reported
// rectangles, and every behavior point presses at the center of one. A build that
// reports none of them is unreadable on all of it, and a player with only a
// pointer cannot reach a single screen.
//
// THE IDS ARE ASSERTED IN ORDER, not as a set. `menu-<i>` is defined by its index
// into the screen's item list — specs/controls.md: "A `menu-<i>` target covers
// the drawn menu item that `state.menuIndex` `i` highlights" — so a build that
// reported the pair the other way round would highlight `QUIT` when the pointer
// is over `RESUME`, and take the wrong one on the release. The order is the
// claim, so the order is what is read.
//
// HOW EACH SCREEN IS REACHED. Through `reachScreen`, the harness's own sequence
// of the atomic poses specs/instrumentation.md gives: a `reset`, a posed board
// under the four screens specs/ui.md draws one behind, and `setScreen`. Nothing
// here depends on a menu's ordering, on a key binding, or on the level and end
// conditions that raise `levelclear` and `gameover` in play — those are other
// items' requirements, and a route through them would put their failures on this
// point. `setScreen` shows a screen and changes nothing else, and the screen
// behaves from there exactly as it does when a player reaches it, so the targets
// read here are the targets a player sees.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { SCREENS, type Screen } from "../constants";
import {
  captureStill,
  createHarness,
  reachScreen,
  type Harness,
} from "../harness";

/**
 * The ids specs/controls.md names for each screen, in the order that file lists
 * them.
 *
 * The two-item menus are written out rather than derived from the item lists, so
 * this table is the specification's sentence copied down and a check reading it
 * is not reading a derivation of the case's own.
 */
const EXPECTED: Readonly<Record<Screen, readonly string[]>> = {
  title: ["menu-0", "menu-1"],
  howto: ["back"],
  playing: ["pause"],
  paused: ["menu-0", "menu-1"],
  levelclear: ["menu-0", "menu-1"],
  gameover: ["menu-0", "menu-1"],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports exactly the ids specs/controls.md names for each screen", async () => {
  for (const screen of SCREENS) {
    const reading = await reachScreen(h, screen);
    assertDeepEqual(
      reading.targets.map((target) => target.id),
      EXPECTED[screen],
      `the target ids the ${screen} screen reports, in order`,
    );

    if (screen === "title") {
      // One frame, so the picture is of the title screen the ids were read on.
      await h.advance(1);
      await captureStill(h, "targets");
    }
  }
});
