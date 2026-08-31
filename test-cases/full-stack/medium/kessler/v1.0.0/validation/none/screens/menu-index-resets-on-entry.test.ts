// screens/menu-index-resets-on-entry — arriving at a menu highlights its first
// entry.
//
// specs/screens.md, on menus: "Entering a menu-bearing screen highlights entry
// `0`", however far the highlight had moved on the last menu.
//
// The highlight is moved on the pause menu, and the title menu is then entered
// through the surface: `setScreen('title')` leaves the session "exactly as
// QUIT does", and `setScreen` enters a screen "exactly as the real transition
// into it enters it" (specs/instrumentation.md). The move that gives the last
// menu a displaced highlight is asserted as a precondition so a broken `down`
// fails by that name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, PAUSE_MENU } from "../constants";
import {
  captureStill,
  openHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The key specs/controls.md binds to `down`. */
const DOWN = BINDINGS.down[0];

it("highlights entry 0 on entering a menu-bearing screen", async () => {
  await poseScene(h, "playing");
  await h.debug.setScreen("paused");
  await tap(h, DOWN);
  const moved = await h.snapshot();
  assertEqual(
    moved.menu.index,
    PAUSE_MENU.length - 1,
    "the moved highlight on the pause menu, before leaving it",
  );

  await h.debug.setScreen("title");
  await h.frameDraw();
  await captureStill(h, "entered");

  const after = await h.snapshot();
  assertEqual(after.screen, "title", "the menu-bearing screen entered");
  assertEqual(after.menu.index, 0, "the highlight on the freshly entered menu");
});
