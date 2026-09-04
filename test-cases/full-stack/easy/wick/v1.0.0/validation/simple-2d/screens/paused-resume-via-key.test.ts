// screens/paused-resume-via-key — pause on paused resumes the run.
//
// WHAT THIS DECIDES. One thing, in one direction: a `pause` press on `paused`
// leaves the game on `playing` with the run exactly as the pause left it.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "`pause` returns to `playing`".
//   specs/controls.md ("What each screen reads"): "`paused` | none | `up`,
//   `down` move the highlight, wrapping; `confirm` takes the highlighted item;
//   `pause` resumes; `back` resumes; `mute`", and `pause` is `KeyP`.
//   specs/instrumentation.md (`setScreen`): "`playing` | `paused` | Resumes
//   exactly as `pause` on `paused` does; the run is untouched."
//
// THE DRIVE, AND WHY THE FRAME IS SHORT. An isolated `playing` run with a posed
// clock and one enemy, paused through `setScreen("paused")` so the pause key is
// not on the way in, then one `KeyP` delivered on a frame of half a tick. A
// frame whose press enters `playing` "runs that frame's ticks"
// (specs/controls.md), so a full frame would leave the run one tick past the
// pause and this point could not tell a resumed run from an advanced one. Half
// a tick delivers the same edge and consumes none, since "A tick is consumed
// while the accumulator is at least `TICK_DT − TICK_EPSILON`"
// (specs/instrumentation.md), so what is read is the run the resume handed back.
//
// THE TOLERANCE. None: a screen name and the run's stored fields are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  runFields,
  spawnEnemyAt,
  tapWithoutTick,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns to playing with the run the pause held", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", -180, 60);
  h.debug.setTick(4321);
  h.debug.setHp(72);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen KeyP is pressed on");

  const after = await tapWithoutTick(h, "KeyP");
  captureStill(h, "resumed");

  assertEqual(after.screen, "playing", "the screen KeyP left the game on");
  assertDeepEqual(
    runFields(after.run),
    runFields(before.run),
    "the resumed run, against the run the pause held",
  );
});
