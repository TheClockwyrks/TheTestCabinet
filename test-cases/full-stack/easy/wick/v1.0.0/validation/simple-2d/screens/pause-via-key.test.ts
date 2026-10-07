// screens/pause-via-key — pause on playing enters the pause screen.
//
// WHAT THIS DECIDES. One thing, in one direction: a `pause` press on `playing`
// leaves the game on `paused` with `menuIndex` 0 and the run untouched. The
// return trip is `paused-resume-via-key`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "The world held still, with the HUD, under
//   `PAUSED_TEXT`", and "`menuIndex` is `0` on entering every screen"
//   (specs/state.md).
//   specs/controls.md ("Actions and bindings"): `pause` is `KeyP`, read as an
//   edge, and "`pause` opens `paused`" on `playing`.
//   specs/ui.md ("What advances on each screen"): on `levelup`, `chest`, and
//   `paused`, "Nothing. The world beneath holds exactly the tick it was at",
//   and "The delta time left unconsumed is discarded on any frame or pose that
//   leaves `playing`", so the accumulator is `0` on the pause screen.
//
// THE DRIVE. An isolated `playing` run holding one enemy, a posed clock, and a
// posed `hp`, with every driver switch off, so the only thing that could change
// the run across the pressing frame is the build ticking a screen that does not
// tick. The run is read whole before the press and whole after it, and compared
// field for field, which catches a build that advanced its clock, aged the
// enemy, or moved the lamplighter on the way in.
//
// THE TOLERANCE. None: a screen name, a menu index, and the run's stored fields
// are exact figures, and the accumulator is compared to the `0` the
// specification states.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  runFields,
  spawnEnemyAt,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the run still on the pause screen", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", 240, -80);
  h.debug.setTick(1234);
  h.debug.setHp(55);
  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen KeyP is pressed on");

  const after = await tap(h, "KeyP");
  captureStill(h, "paused");

  assertEqual(after.screen, "paused", "the screen KeyP left the game on");
  assertEqual(after.menuIndex, 0, "the highlight on arriving at paused");
  assertEqual(
    after.accumulator,
    0,
    "the accumulator on a screen that is not playing",
  );
  assertDeepEqual(
    runFields(after.run),
    runFields(before.run),
    "the run after the pause, against the run the pause found",
  );
});
