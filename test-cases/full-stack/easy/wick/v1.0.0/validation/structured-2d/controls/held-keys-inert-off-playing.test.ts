// controls/held-keys-inert-off-playing — held movement keys move nothing off
// playing.
//
// WHAT THIS DECIDES. One thing: a movement key held on a screen other than
// `playing` moves the lamplighter nowhere, on `paused` and on `levelup`
// alike. That the same key moves it ON `playing` is the lamplighter's
// business.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("What each screen reads"): the Held column is "none"
//   for every screen but `playing`, whose row alone holds "`up`, `down`,
//   `left`, `right`"; and "An action a row omits does nothing on that
//   screen."
//   specs/controls.md ("Moving the lamplighter"): "On `playing`, the four
//   movement actions are read as held values, sampled once per frame and
//   applied to every tick that frame consumes."
//   specs/ui.md ("What advances on each screen"): on `levelup`, `chest`,
//   `paused`, "Nothing. The world beneath holds exactly the tick it was at."
//
// THE DRIVE. An isolated world with the lamplighter at the origin, posed to
// `paused` through the surface exactly as `pause` enters it; `ArrowRight` is
// held across 60 frames there and released. The screen is then posed back to
// `playing`, which resumes the untouched run, and the level-up overlay is
// opened the way a gain opens it, by one `playing` tick with a level-up
// pending and no key down; `ArrowRight` is held across 60 frames there too.
// Sixty frames on `playing` would be 180 units, so a build reading held
// values on either screen is out by whole units, and a build that banked the
// frames as ticks to run later is caught by the resumed tick before the
// overlay opens.
//
// THE TOLERANCE. `MOTION_EPS`, the suite's bound for an integrated position:
// nothing moves the lamplighter here, so a conformant build reads the origin
// exactly, and a single tick of movement is 3 units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  hold,
  isolate,
  openLevelUp,
  poseScreen,
  type Harness,
} from "../harness";

/** Frames the key stays down on each screen: a second's worth. */
const HELD_FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves player.x at the origin while ArrowRight is held on paused and on levelup", async () => {
  isolate(h);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the first screen the key is held on");
  assertEqual(paused.run.player.x, 0, "player.x before the hold on paused");

  const afterPaused = await hold(h, "ArrowRight", HELD_FRAMES);
  assertEqual(
    afterPaused.screen,
    "paused",
    "the screen after the hold on paused",
  );

  poseScreen(h, "playing");
  const overlay = await openLevelUp(h, 1);
  assertEqual(
    overlay.screen,
    "levelup",
    "the second screen the key is held on",
  );

  const afterOverlay = await hold(h, "ArrowRight", HELD_FRAMES);
  captureStill(h, "held");

  assertEqual(
    afterOverlay.screen,
    "levelup",
    "the screen after the hold on levelup",
  );
  assertNear(
    afterPaused.run.player.x,
    0,
    MOTION_EPS,
    "player.x after 60 frames of ArrowRight on paused",
  );
  assertNear(
    afterOverlay.run.player.x,
    0,
    MOTION_EPS,
    "player.x after 60 frames of ArrowRight on levelup",
  );
});
