// Wick — pointer/paused-touch-resumes: a contact landing and lifting in
// `RESUME`'s rectangle returns to the run.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "a contact landing and lifting inside the rectangle of the
// item at `menuIndex` `i` selects that item and takes it exactly as `confirm` on
// it does." `specs/ui.md`, "`paused`": `RESUME` "Returns to the run: `screen =
// playing`, the run exactly as the pause left it."
//
// WHY THIS IS ITS OWN POINT. A pause a player cannot leave is a run they cannot
// finish. The mouse's route is `pointer/paused-click-resumes`'.
//
// WHAT IS READ. The screen after the gesture, and the whole run against the run
// the pause held.
//
// THE DRIVE. An isolated night carrying a posed clock, a posed position, and an
// enemy, held under `setScreen("paused")`, which enters the pause "exactly as
// `pause` does"; then a contact landing at the middle of `RESUME`'s rectangle
// and lifting there, one partial frame each, so no tick advances the run under
// the reading.
//
// THE TOLERANCE. None: a screen name and the run against itself.

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
import { touchTapRectPartial } from "./pointing";

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

it("reads playing with the run the pause held after a contact takes RESUME", async () => {
  h.reset();
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  placeEnemy(h, "moth", PLAYER_X + 150, PLAYER_Y - 90);

  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the contact lands on");
  assertEqual(paused.menuIndex, RESUME, "the highlighted item, RESUME");

  const rects = menuRects(h);
  assertLength(rects, PAUSE_ITEMS.length, "the pause menu's rectangles");

  const after = await touchTapRectPartial(h, rects[RESUME]);
  captureStill(h, "resumed");

  assertEqual(after.screen, "playing", "the screen the contact left");
  assertDeepEqual(after.run, paused.run, "the run across the resuming frames");
});
