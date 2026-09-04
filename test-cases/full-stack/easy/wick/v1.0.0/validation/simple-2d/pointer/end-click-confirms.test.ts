// pointer/end-click-confirms — clicking `TRY AGAIN` on `fallen` starts a fresh
// run.
//
// WHAT THIS DECIDES. One thing: a primary press inside `TRY AGAIN`'s rectangle
// on the `fallen` screen leaves the game on `playing` with a fresh run. What a
// fresh run's every field holds is its own point under Screens; what this one
// adds is that the mouse reaches it from an ended night.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "A primary press edge inside the
//   rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i`, playing
//   `menu-move` if that changed it, and then takes that item exactly as
//   `confirm` on it does."
//   specs/ui.md ("`fallen` and `dawn`"): "`TRY AGAIN` starts a fresh run and
//   sets `screen = playing`", the menu being "`END_ITEMS`: `TRY AGAIN`,
//   `TITLE`, in that order", and "`menuIndex` is `0` on arriving".
//   specs/ui.md ("A fresh run"): "the lamplighter at the world origin `(0, 0)`
//   with `hp = BASE_MAX_HP` (`100`) ... Taper at level `1` alone in the first
//   weapon slot", restated as `FRESH_RUN`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The screen and the run's stored
// fields after the click, against `FRESH_RUN`. The ended run carries a clock,
// kills, and a level of its own, so a build that returned to `playing` on the
// old run differs from that fixture.
//
// THE DRIVE, AND WHY THE FRAME IS SHORT. An isolated run loaded with a clock,
// kills, and a level, ended the way the rule ends it: "the fallen ending is
// `setHp` at `0` and one tick" (specs/instrumentation.md), which is what
// `endFallen` composes, so the end screen is reached by the ending rather than
// around it.
// "A frame whose press enters `playing` ... runs that frame's ticks"
// (specs/controls.md), so a whole frame would leave the run one tick old; a
// frame of half a tick delivers the same press and consumes none, since "A tick
// is consumed while the accumulator is at least `TICK_DT − TICK_EPSILON`"
// (specs/instrumentation.md).
//
// THE TOLERANCE. None: a screen name and the fresh run's stored fields are
// exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { END_ITEMS, FRESH_RUN } from "../constants";
import {
  captureStill,
  createHarness,
  endFallen,
  isolate,
  runFields,
  type Harness,
} from "../harness";
import { clickRectWithoutTick, menuRectAt } from "./pointing";

let h: Harness;

/** The item clicked: `TRY AGAIN`, position 0 of `END_ITEMS`. */
const CLICKED = END_ITEMS.indexOf("TRY AGAIN");

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("starts a fresh run when TRY AGAIN is clicked on the fallen screen", async () => {
  isolate(h, { level: 11 });
  h.debug.setTick(6000);
  h.debug.setKills(52);
  await endFallen(h);
  const before = h.snapshot();
  assertEqual(before.screen, "fallen", "the screen the click lands on");
  assertEqual(before.menuIndex, CLICKED, "the highlight resting on TRY AGAIN");

  const rect = menuRectAt(h, CLICKED, "the TRY AGAIN item");
  const after = await clickRectWithoutTick(h, rect);
  captureStill(h, "again");

  assertEqual(after.screen, "playing", "the screen the click left the game on");
  assertDeepEqual(
    runFields(after.run),
    FRESH_RUN,
    "the run the click started, as specs/ui.md's fresh run fixes it",
  );
});
