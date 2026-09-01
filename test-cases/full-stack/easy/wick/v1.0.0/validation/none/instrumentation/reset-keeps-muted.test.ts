// Wick — instrumentation/reset-keeps-muted: `muted` holds the same value after
// `reset()` as before it, whether it was `true` or `false`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `reset(options)`):
// "`muted` stays as it is." The snapshot's `muted` "mirrors the runtime's mute
// bit, refreshed in every frame", and the one way to set that bit is the
// `mute` action, bound to `KeyM` and "toggles sound, on every screen"
// (specs/controls.md).
//
// WHY THE WORLD IS POSED AS IT IS. The surface carries no operation for muting,
// so the `true` half is reached through the real key, the one route there is;
// a frame is run after each press so the mirror is refreshed before the read.
// Both halves are read, since a reset that forces the bit either way passes
// exactly one of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressMute,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves muted as it was, unmuted and muted alike", async () => {
  const unmuted = await h.step(1);
  assertEqual(unmuted.muted, false, "muted before the first reset");
  await h.debug.reset();
  await h.step(1);
  assertEqual(
    (await h.snapshot()).muted,
    false,
    "muted after a reset while unmuted",
  );

  const muted = await pressMute(h);
  assertEqual(muted.muted, true, "muted after the mute key");
  await h.debug.reset();
  const after = await h.step(1);
  await captureStill(h, "muted");
  assertEqual(after.muted, true, "muted after a reset while muted");
});
