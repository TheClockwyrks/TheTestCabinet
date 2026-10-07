// Wick — screens/pause-via-key: `pause` on `playing` enters the pause screen
// with the run untouched.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "What each
// screen reads": on `playing`, "`pause` opens `paused`", and `pause` is bound
// to `KeyP`. `specs/ui.md`, "Menu navigation": "`menuIndex` is `0` on entering
// every screen". `specs/ui.md`, "What advances on each screen", gives `paused`
// "Nothing. The world beneath holds exactly the tick it was at", and
// `specs/controls.md` adds that "a frame whose press leaves `playing` ticks
// nothing and discards the accumulator" — so the run the pause reads is the
// run of the moment before, field for field, with the accumulator at `0`.
//
// THE DRIVE. An isolated `playing` world holding one moth, the lamplighter
// posed away from the origin and the clock posed off `0`, so a build that
// reset or rebuilt the run on pausing shows up in the comparison rather than
// hiding behind zeroes. Every driver switch is off, so nothing but the press
// could move the run across the frame. Then one real `KeyP`.
//
// THE TOLERANCE. None: the whole run is compared field for field against the
// one read before the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  tap,
  type Harness,
} from "../harness";

/** Where the lamplighter stands, and the clock it stands at, before the pause. */
const PLAYER_X = 50;
const PLAYER_Y = -20;
const TICK = 600;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads paused with menuIndex 0 and the run as it stood", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  h.debug.setPlayerPosition(PLAYER_X, PLAYER_Y);
  placeEnemy(h, "moth", PLAYER_X + 200, PLAYER_Y + 100);
  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen the press is made on");

  const after = await tap(h, "KeyP");
  captureStill(h, "paused");

  assertEqual(after.screen, "paused", "the screen after KeyP on playing");
  assertEqual(after.menuIndex, 0, "menuIndex on arriving at the pause screen");
  assertDeepEqual(after.run, before.run, "the run across the pausing frame");
  assertEqual(after.accumulator, 0, "the accumulator on the pause screen");
});
