// instrumentation/reset-keeps-muted — `muted` holds the same value after
// `reset()` as before it, whether it was true or false.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `reset`: "`muted`
// stays as it is"; and "`muted` mirrors the runtime's mute bit, refreshed in
// every frame". specs/ui.md: "The game binds the `mute` action to
// `api.audio.setMuted` and toggles it from any screen", and specs/controls.md
// binds `mute` to `KeyM`, read as an edge on every screen.
//
// THE POSE. The mute bit is flipped the one way a game state can flip it, a
// real `KeyM` edge on the title, with a second frame after it so a build that
// mirrors the bit a frame later has caught up. Each reset is read without a
// frame between: the value is "as it is" at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";

/** The key specs/controls.md binds `mute` to. */
const MUTE_KEY = "KeyM";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the mute bit across a reset, muted and unmuted", async () => {
  h.reset();
  await tap(h, MUTE_KEY);
  const muted = await h.tick(1);
  assertEqual(muted.muted, true, "muted after one mute press");

  h.reset();
  assertEqual(h.snapshot().muted, true, "muted after a reset issued muted");

  await tap(h, MUTE_KEY);
  const unmuted = await h.tick(1);
  assertEqual(unmuted.muted, false, "muted after the second press");

  h.reset();
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "muted");
  assertEqual(s.muted, false, "muted after a reset issued unmuted");
});
