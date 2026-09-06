// Wick — instrumentation/reset-keeps-muted: `muted` holds the same value after
// `reset()` as before it, whether it was true or false.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `reset(options)`: "`muted` stays as it is"; "A render-free core":
// "`muted` mirrors the runtime"; "Snapshot shape": "`muted` mirrors the
// runtime's mute bit, refreshed in every frame, since the runtime owns muting".
//
// THE POSE. The runtime's own mute bit is set through the engine's bus
// (`world.audio.setMuted`, which `specs/ui.md` has the `mute` action bound
// to), and one frame runs so the game mirrors it; the key binding is another
// item's. Then `reset`, read at the call and again a frame later, in both
// states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries muted across reset, false and true alike", async () => {
  isolate(h);
  await h.advance(1);
  assertEqual(h.snapshot().muted, false, "muted before the first reset");
  h.reset();
  assertEqual(h.snapshot().muted, false, "muted at the reset call, unmuted");
  await h.advance(1);
  assertEqual(h.snapshot().muted, false, "muted a frame after reset, unmuted");

  isolate(h);
  h.world.audio.setMuted(true);
  await h.advance(1);
  assertEqual(
    h.snapshot().muted,
    true,
    "muted mirrored before the second reset",
  );
  h.reset();
  const atCall = h.snapshot().muted;
  await h.frameDraw();
  captureStill(h, "muted");
  assertEqual(atCall, true, "muted at the reset call, muted");
  assertEqual(h.snapshot().muted, true, "muted a frame after reset, muted");
});
