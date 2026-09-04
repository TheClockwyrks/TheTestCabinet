// screens/mute-toggles-from-any-screen — mute toggles from every screen.
//
// WHAT THIS DECIDES. One thing, over all nine screens: the `mute` key flips
// the reported mute bit wherever it is pressed. The nine share one point
// because they exercise one rule, "`mute` is read on every screen", the same
// way; what the flip does to a running loop is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("Menu navigation"): "`pause` is read on `playing` and `paused`
//   alone, the movement actions are read as held values on `playing` alone, and
//   `mute` is read on every screen."
//   specs/ui.md ("Audio"): "The game binds the `mute` action to
//   `api.audio.setMuted` and toggles it from any screen, then mirrors
//   `api.audio.muted()` into `muted` every frame."
//   specs/controls.md ("Actions and bindings"): "`mute` | `KeyM` | edge |
//   toggles sound, on every screen", and every screen row lists `mute`.
//   specs/state.md (`WickState`): "`muted`: the game's readable copy of the
//   engine's mute bit, refreshed every frame."
//
// THE DRIVE. Each screen is reached the shortest way the specification allows
// and never through another screen's menu: `title`, `howto`, `almanac`, and
// `paused` through `setScreen`, which "sets `screen` to `name`"
// (specs/instrumentation.md), `playing` through `isolate`, `levelup` by the
// tick a queued level-up opens it, `chest` by the tick that collects a chest at
// the lamplighter's center, `fallen` by the tick `hp` at `0` ends the run on,
// and `dawn` by the tick that crosses `DAWN_TIME × TICK_HZ`, which `setTick`
// cannot pose. The bit is read before each press and compared against its
// opposite after, so the reading is a FLIP rather than a value, whichever way
// the bit was left by the screen before.
//
// WHY A FRAME FOLLOWS EACH PRESS. The specification requires the mirror "every
// frame" and fixes no order within one, so a build that mirrors before it reads
// input reports the flip on the next frame; a build that never flips reports it
// on neither.
//
// THE TOLERANCE. None: a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCREENS, type Screen } from "../constants";
import {
  captureStill,
  createHarness,
  endDawn,
  endFallen,
  isolate,
  openChest,
  openLevelUp,
  poseScene,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

/** Reach `screen` through the shortest path specs/instrumentation.md gives it. */
async function reach(harness: Harness, screen: Screen): Promise<void> {
  if (screen === "title" || screen === "howto" || screen === "almanac") {
    poseScene(harness, screen);
    return;
  }
  isolate(harness);
  if (screen === "playing") return;
  if (screen === "levelup") {
    await openLevelUp(harness, 1);
    return;
  }
  if (screen === "chest") {
    await openChest(harness);
    return;
  }
  if (screen === "dawn") {
    await endDawn(harness);
    return;
  }
  if (screen === "fallen") {
    await endFallen(harness);
    return;
  }
  harness.debug.setScreen(screen);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("flips the mute bit on every one of the nine screens", async () => {
  for (const screen of SCREENS) {
    await reach(h, screen);
    const before = h.snapshot();
    assertEqual(
      before.screen,
      screen,
      `the screen KeyM is pressed on (${screen})`,
    );

    await tap(h, "KeyM");
    const after = await h.tick(1);
    assertEqual(
      after.muted,
      !before.muted,
      `the mute bit after KeyM on ${screen}`,
    );
  }
  captureStill(h, "muted");
});
