// instrumentation/set-screen-levelup — `setScreen('levelup')` from playing
// stands the game on levelup with menuIndex 0, opening no overlay.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setScreen`: "Sets
// `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// The pose opens no overlay: "a run is never begun, discarded, ended, or grown
// by it", and "the level-up overlay is `setPendingLevelUps` and one `playing`
// tick", which `progression/overlay-opens-same-tick` decides.
// The empty `offers` afterwards is what shows the pose drew nothing.
//
// THE POSE. An isolated night with nothing queued, so the `levelup` the reading
// finds is the pose's rather than an overlay the game opened for itself, and
// the empty `offers` afterwards is the pose declining to draw. No tick is run,
// so nothing else could have moved the screen.
//
// THE TOLERANCE. None: a screen name, a menu index, and a list length.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("stands the game on the level-up screen", async () => {
  const posed = isolate(h, { keepTaper: true });
  assertEqual(posed.screen, "playing", "the screen the call is made from");
  assertEqual(posed.run.pendingLevelUps, 0, "pendingLevelUps before the call");

  h.debug.setScreen("levelup");
  const levelup = h.snapshot();
  captureStill(h, "levelup");

  assertEqual(
    levelup.screen,
    "levelup",
    "the screen after setScreen('levelup')",
  );
  assertEqual(levelup.menuIndex, 0, "menuIndex on entering levelup");
  assertLength(levelup.run.offers, 0, "the offers the pose drew");
  assertEqual(
    levelup.run.pendingLevelUps,
    0,
    "pendingLevelUps the pose queued",
  );
});
