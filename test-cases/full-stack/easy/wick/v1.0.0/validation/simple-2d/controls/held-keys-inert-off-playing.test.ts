// controls/held-keys-inert-off-playing — held movement keys move nothing off
// `playing`.
//
// WHAT THIS DECIDES. One thing: the movement actions are held values on
// `playing` ALONE, so a movement key held on `paused` and on `levelup` leaves
// the lamplighter where it stands. That the world beneath those screens does
// not tick is decided under instrumentation (frame-off-playing-ticks-nothing);
// this point is the INPUT side of the same rule, a held key that a build
// might apply outside its ticks.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("What each screen reads"): `paused` reads "none" of
//   the held actions and `levelup` reads "none"; only `playing` reads "`up`,
//   `down`, `left`, `right`". "An action a row omits does nothing on that
//   screen."
//   specs/controls.md ("Moving the lamplighter"): "On `playing`, the four
//   movement actions are read as held values".
//   specs/ui.md ("Menu navigation"): "the movement actions are read as held
//   values on `playing` alone".
//   specs/world.md ("Movement"): the velocity is the direction "times
//   `moveSpeed`, and each tick the position advances by the velocity times
//   `TICK_DT`", so a build that let the key through moves `MOVE_SPEED ×
//   TICK_DT` = 3 units on every tick it leaked.
//
// THE DRIVE. An isolated run (`isolate`: the empty night, every driver switch
// off, no weapon held), so nothing but the key under test could move the
// lamplighter. `paused` is entered through `setScreen("paused")`, "Exactly as
// `pause` does" (specs/instrumentation.md), so the pause key is not on the
// route; `ArrowRight` is held across 60 frames and released. The run is then
// resumed through `setScreen("playing")` and the overlay opened by the real
// path (`openLevelUp`: one level-up queued, one `playing` tick with no key
// down), and `ArrowRight` is held across 60 frames again. `player.x` is read
// before and after each hold.
//
// THE TOLERANCE. `MOTION_TOLERANCE` (1e-6 units, constants.ts) on a figure the
// spec fixes at exactly zero movement. Nothing integrates on either screen,
// so the reading is the same number the pose wrote; the tolerance only admits
// the float noise of a build that stores its position through a projection.
// One leaked tick is 3 units, three million times the tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { MOTION_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  hold,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** Frames the key is held on each screen: the span the item names. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves player.x where it stands while ArrowRight is held on paused and on levelup", async () => {
  isolate(h);

  h.debug.setScreen("paused");
  const paused = h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the key is first held on");

  const afterPaused = await hold(h, "ArrowRight", HELD_FRAMES);
  assertEqual(
    afterPaused.screen,
    "paused",
    "the screen the hold left the game on",
  );
  assertWithin(
    afterPaused.run.player.x,
    paused.run.player.x,
    MOTION_TOLERANCE,
    `player.x after ${HELD_FRAMES} frames of ArrowRight held on paused`,
  );

  h.debug.setScreen("playing");
  const levelup = await openLevelUp(h, 1);
  assertEqual(levelup.screen, "levelup", "the screen the key is next held on");

  const afterLevelup = await hold(h, "ArrowRight", HELD_FRAMES);
  captureStill(h, "held");

  assertEqual(
    afterLevelup.screen,
    "levelup",
    "the screen the hold left the game on",
  );
  assertWithin(
    afterLevelup.run.player.x,
    levelup.run.player.x,
    MOTION_TOLERANCE,
    `player.x after ${HELD_FRAMES} frames of ArrowRight held on levelup`,
  );
});
