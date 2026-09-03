// pointer/paused-click-resumes — clicking `RESUME` returns to the run.
//
// WHAT THIS DECIDES. One thing: a primary press inside `RESUME`'s rectangle
// leaves the game on `playing` with the run exactly as the pause held it. What
// clicking `MAIN MENU` does is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "A primary press edge inside the
//   rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i`, playing
//   `menu-move` if that changed it, and then takes that item exactly as
//   `confirm` on it does."
//   specs/ui.md (`paused`): "`RESUME` | Sets `screen = playing`, with the run
//   untouched", the menu `PAUSE_ITEMS` being "`RESUME`, `MAIN MENU`, in that
//   order", and "`menuIndex` is `0` on arriving".
//   specs/instrumentation.md (Menus): each rectangle "is the area a hover or a
//   click selects that item inside".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The screen after the click, and
// the run's stored fields against the run the pause was holding a moment
// earlier. "Untouched" is a comparison, not a fixture, so the run is loaded
// with a clock, a wound, and an enemy first and read back field for field.
//
// THE DRIVE, AND WHY THE FRAME IS SHORT. An isolated `playing` run with a posed
// clock, a posed health, and one enemy, paused through `setScreen("paused")` so
// the pause key is not on the way in. "A frame whose press enters `playing` ...
// runs that frame's ticks" (specs/controls.md), so a whole frame would leave
// the run one tick past the pause and this point could not tell a resumed run
// from an advanced one; a frame of half a tick delivers the same press and
// consumes none, since "A tick is consumed while the accumulator is at least
// `TICK_DT − TICK_EPSILON`" (specs/instrumentation.md).
//
// THE TOLERANCE. None: a screen name and the run's stored fields are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  runFields,
  spawnEnemyAt,
  type Harness,
} from "../harness";
import { clickRectWithoutTick, menuRectAt } from "./pointing";

let h: Harness;

/** The item clicked: `RESUME`, position 0 of `PAUSE_ITEMS`. */
const CLICKED = PAUSE_ITEMS.indexOf("RESUME");

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing with the run the pause held when RESUME is clicked", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", -180, 60);
  h.debug.setTick(4321);
  h.debug.setHp(72);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen the click lands on");
  assertEqual(before.menuIndex, CLICKED, "the highlight resting on RESUME");

  const rect = menuRectAt(h, CLICKED, "the RESUME item");
  const after = await clickRectWithoutTick(h, rect);
  captureStill(h, "resumed");

  assertEqual(after.screen, "playing", "the screen the click left the game on");
  assertDeepEqual(
    runFields(after.run),
    runFields(before.run),
    "the resumed run, against the run the pause held",
  );
});
