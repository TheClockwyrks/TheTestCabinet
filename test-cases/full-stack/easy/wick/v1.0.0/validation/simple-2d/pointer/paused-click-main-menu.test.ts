// pointer/paused-click-main-menu — clicking `MAIN MENU` abandons the run.
//
// WHAT THIS DECIDES. One thing: a primary press inside `MAIN MENU`'s rectangle
// leaves the game on `title` with `menuIndex` `0` and the idle run, so the
// night is let go of rather than kept behind the front door. What clicking
// `RESUME` does is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "A primary press edge inside the
//   rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i`, playing
//   `menu-move` if that changed it, and then takes that item exactly as
//   `confirm` on it does."
//   specs/ui.md (`paused`): "`MAIN MENU` | Abandons the run and returns to
//   `title` with `menuIndex = 0`", the menu `PAUSE_ITEMS` being "`RESUME`,
//   `MAIN MENU`, in that order", and "`menuIndex` is `0` on arriving".
//   specs/state.md (The idle run): "`run` holds the values below whenever
//   `screen` is `title`, `howto`, or `almanac` ... leaving a run for the title
//   restores them", the table restated as `IDLE_RUN`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The screen, the highlight, and
// the run's stored fields against `IDLE_RUN`. The run is loaded with a clock,
// kills, a level, and an enemy before the click, so the idle run read
// afterwards is a fact about what the click discarded rather than about a run
// that was already empty.
//
// THE DRIVE. An isolated `playing` run, paused through `setScreen("paused")`
// so the pause key is not on the way in, with the highlight asserted at `0`
// before the press so the item clicked is provably not the item highlighted.
// Then a primary press at the middle of the rectangle the build reported for
// position `1`, and the one frame that reads it. Nothing advances on `title`
// (specs/ui.md, What advances on each screen), so the frame is a whole one.
//
// THE TOLERANCE. None: a screen name, a menu index, and the idle run's stored
// fields are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotEqual } from "../assert";
import { IDLE_RUN, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  isolate,
  runFields,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

/** The item clicked: `MAIN MENU`, position 1 of `PAUSE_ITEMS`. */
const CLICKED = PAUSE_ITEMS.indexOf("MAIN MENU");

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to the title on the idle run when MAIN MENU is clicked", async () => {
  isolate(h, { level: 11 });
  spawnEnemyAt(h, "moth", 260, -60);
  h.debug.setTick(6000);
  h.debug.setKills(52);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen the click lands on");
  assertEqual(before.menuIndex, 0, "the highlight before the click");
  assertNotEqual(
    before.menuIndex,
    CLICKED,
    "the highlight, which the clicked item is deliberately not on",
  );

  const rect = menuRectAt(h, CLICKED, "the MAIN MENU item");
  const after = await clickRect(h, rect);
  captureStill(h, "abandoned");

  assertEqual(after.screen, "title", "the screen the click left the game on");
  assertEqual(after.menuIndex, 0, "the highlight on arriving at the title");
  assertDeepEqual(
    runFields(after.run),
    IDLE_RUN,
    "the run the click left behind, as specs/state.md's idle table fixes it",
  );
});
