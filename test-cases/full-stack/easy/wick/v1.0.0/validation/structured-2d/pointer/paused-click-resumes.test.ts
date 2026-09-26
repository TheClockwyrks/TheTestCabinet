// Wick — pointer/paused-click-resumes: clicking RESUME returns to the run,
// untouched.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 2, Click: "A primary press edge inside the rectangle of the item at
// `menuIndex` `i` sets `menuIndex` to `i` ... and then takes that item exactly
// as `confirm` on it does." `specs/ui.md`, "`paused`", gives the menu
// `PAUSE_ITEMS`, "`RESUME`, `MAIN MENU`, in that order", with `menuIndex` `0`
// on arriving, and `RESUME`: "Sets `screen = playing`, with the run untouched."
// `specs/ui.md`, "What advances on each screen", holds the world beneath a
// pause exactly at the tick it was at, so the run that comes back is the run
// that was paused.
//
// WHY THE CLICK RUNS NO TICK. `specs/controls.md`: "a frame whose press enters
// `playing` ... runs that frame's ticks", so a whole-tick frame would resume
// AND advance the run, and the comparison would read a tick's work rather than
// the resume. The press is delivered on a frame of a single millisecond
// instead, which `specs/instrumentation.md` calls a partial frame and which is
// far short of the `TICK_DT − TICK_EPSILON` a tick is consumed at.
//
// THE DRIVE. An isolated `playing` world holding one moth, the lamplighter
// posed away from the origin and the clock posed off `0`, so a resume that
// restarted or discarded anything is unmistakable; the pause posed through
// `setScreen("paused")` — by setting `screen` alone, with the run left as it
// stands (`specs/instrumentation.md`) — and the run read there; then a primary
// press and release in the middle of `RESUME`'s own rectangle, read off
// `menuRects`.
//
// THE TOLERANCE. None: the whole run is compared field for field.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  menuRects,
  placeEnemy,
  poseScreen,
  type Harness,
} from "../harness";
import { clickRectPartial } from "./pointing";

/** The index of RESUME, the first item of PAUSE_ITEMS (specs/ui.md). */
const RESUME = 0;

const PLAYER_X = -80;
const PLAYER_Y = 35;
const TICK = 900;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads playing with the run the pause held after a click on RESUME", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  placeEnemy(h, "moth", PLAYER_X + 150, PLAYER_Y - 90);

  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the click is made on");
  assertEqual(paused.menuIndex, RESUME, "the highlighted item, RESUME");

  const rects = menuRects(h);
  assertLength(
    rects,
    PAUSE_ITEMS.length,
    "the pause menu's rectangles, one per item (specs/controls.md, The pointer)",
  );

  const after = await clickRectPartial(h, rects[RESUME]);
  captureStill(h, "resumed");

  assertEqual(
    after.screen,
    "playing",
    "the screen after a click on RESUME (specs/ui.md, paused)",
  );
  assertDeepEqual(after.run, paused.run, "the run across the resuming frame");
});
