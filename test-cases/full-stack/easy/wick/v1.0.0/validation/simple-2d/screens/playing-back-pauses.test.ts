// screens/playing-back-pauses — back on playing opens the pause screen.
//
// WHAT THIS DECIDES. One thing, in one direction: a `back` press on `playing`
// leaves the game on `paused` with `menuIndex` 0 and the run untouched, which
// is what `pause` on `playing` does. The return trip is `paused-back-resumes`,
// and the same trip taken with `KeyP` is `pause-via-key`.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("What each screen reads"): "`playing` | `up`, `down`,
//   `left`, `right` | `pause` opens `paused`; `back` opens `paused`; `mute`",
//   and "`back` on `playing` does exactly what `pause` on `playing` does".
//   specs/controls.md ("Actions and bindings"): `back` is `Escape`, read as an
//   edge.
//   specs/ui.md (`paused`): "The world held still, with the HUD, under
//   `PAUSED_TEXT` (`PAUSED`)", and "`menuIndex` is `0` on arriving".
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
  spawnEnemyAt(h, "moth", -260, 90);
  h.debug.setTick(2468);
  h.debug.setHp(63);
  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen Escape is pressed on");

  const after = await tap(h, "Escape");
  captureStill(h, "paused");

  assertEqual(after.screen, "paused", "the screen Escape left the game on");
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
