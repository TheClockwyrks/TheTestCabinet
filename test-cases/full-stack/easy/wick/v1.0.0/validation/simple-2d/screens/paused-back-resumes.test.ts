// screens/paused-back-resumes — back on paused resumes the run.
//
// WHAT THIS DECIDES. One thing, in one direction: a `back` press on `paused`
// leaves the game on `playing` with the run exactly as the pause left it. The
// same trip taken with `KeyP` is `paused-resume-via-key`, and taken through the
// menu's own `RESUME` item it is `paused-confirm-resume`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "`pause` and `back` both return to `playing` with
//   the run untouched, sounding no cue."
//   specs/controls.md ("What each screen reads"): "`paused` | none | `up`,
//   `down` move the highlight, wrapping; `confirm` takes the highlighted item;
//   `pause` resumes; `back` resumes; `mute`", and `back` is `Escape`, read as
//   an edge.
//   specs/instrumentation.md (`setScreen`): "`paused` | `playing` | Exactly as
//   `pause` does", which is how the pause is posed without pressing a key.
//
// THE DRIVE, AND WHY THE FRAME IS SHORT. An isolated `playing` run with a posed
// clock and one enemy, paused through `setScreen("paused")` so no key is on the
// way in, then one `Escape` delivered on a frame of half a tick. A frame whose
// press enters `playing` "runs that frame's ticks" (specs/controls.md), so a
// full frame would leave the run one tick past the pause and this point could
// not tell a resumed run from an advanced one. Half a tick delivers the same
// edge and consumes none, since "A tick is consumed while the accumulator is at
// least `TICK_DT − TICK_EPSILON`" (specs/instrumentation.md), so what is read
// is the run the resume handed back.
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
  spawnEnemyAt(h, "moth", 150, -210);
  h.debug.setTick(3771);
  h.debug.setHp(81);
  h.debug.setScreen("paused");
  const before = h.snapshot();
  assertEqual(before.screen, "paused", "the screen Escape is pressed on");

  const after = await tapWithoutTick(h, "Escape");
  captureStill(h, "resumed");

  assertEqual(after.screen, "playing", "the screen Escape left the game on");
  assertDeepEqual(
    runFields(after.run),
    runFields(before.run),
    "the resumed run, against the run the pause held",
  );
});
