// pointer/title-click-confirms — clicking `LIGHT THE LAMP` starts a fresh run.
//
// WHAT THIS DECIDES. One thing: a primary press inside the rectangle of the
// title's first item leaves the game on `playing` with a fresh run, so a click
// takes the item it lands in exactly as `confirm` on it does. What a fresh
// run's every field holds is its own point under Screens; what this one adds is
// that the mouse reaches it.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "A primary press edge inside the
//   rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i`, playing
//   `menu-move` if that changed it, and then takes that item exactly as
//   `confirm` on it does."
//   specs/ui.md (`title`): "`LIGHT THE LAMP` | Starts a fresh run, defined
//   below, and sets `screen = playing`", the menu `TITLE_ITEMS` being
//   "`LIGHT THE LAMP`, `THE ALMANAC`, `HOW TO PLAY`, in that order".
//   specs/ui.md ("A fresh run"): "the lamplighter at the world origin `(0, 0)`
//   with `hp = BASE_MAX_HP` (`100`) ... Taper at level `1` alone in the first
//   weapon slot", restated as `FRESH_RUN`.
//   specs/instrumentation.md (Menus): each rectangle "is the area a hover or a
//   click selects that item inside".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The screen and the run's stored
// fields after the click, against `FRESH_RUN`. A build that merely moved the
// highlight, or that started something other than a fresh run, differs from
// that fixture.
//
// THE DRIVE, AND WHY THE FRAME IS SHORT. The title through `setScreen`,
// which "sets `screen` to `name` ... with `menuIndex` ... `0`"
// (specs/instrumentation.md), then a primary press at the middle of the
// rectangle the build reported for position `0`. "The frame's update then runs
// on the screen the edges left: a frame whose press enters `playing` ... runs
// that frame's ticks" (specs/controls.md), so a whole frame would leave the run
// one tick old with the director's first window already spawned; a frame of
// half a tick delivers the same press and consumes none, since "A tick is
// consumed while the accumulator is at least `TICK_DT − TICK_EPSILON`"
// (specs/instrumentation.md), so what is read is the run the click produced.
//
// THE TOLERANCE. None: a screen name and the fresh run's stored fields are
// exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { FRESH_RUN, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  runFields,
  type Harness,
} from "../harness";
import { clickRectWithoutTick, menuRectAt } from "./pointing";

let h: Harness;

/** The item clicked: `LIGHT THE LAMP`, position 0 of `TITLE_ITEMS`. */
const CLICKED = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters playing on a fresh run when the first title item is clicked", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the click lands on");
  assertEqual(
    before.menuIndex,
    CLICKED,
    "the highlight resting on LIGHT THE LAMP",
  );

  const rect = menuRectAt(h, CLICKED, "the first title item");
  const after = await clickRectWithoutTick(h, rect);
  captureStill(h, "click");

  assertEqual(after.screen, "playing", "the screen the click left the game on");
  assertDeepEqual(
    runFields(after.run),
    FRESH_RUN,
    "the run the click started, as specs/ui.md's fresh run fixes it",
  );
});
