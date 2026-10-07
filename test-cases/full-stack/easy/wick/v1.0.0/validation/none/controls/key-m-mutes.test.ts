// controls/key-m-mutes — KeyM toggles mute back off.
//
// WHAT THIS DECIDES. One thing: `mute` is a TOGGLE. Once `KeyM` has set the
// bit, a second `KeyM` clears it. That the first press sets it is the audio
// points' business; this point reads the set bit as its precondition and
// decides the press that takes it back.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`mute` | `KeyM` | edge |
//   toggles sound, on every screen".
//   specs/controls.md ("What each screen reads"): `mute` is in every row, the
//   `title` row included.
//   specs/ui.md ("Audio"): "The game binds the `mute` action to the runtime's
//   mute bit and toggles it from any screen, then mirrors that bit into `muted`
//   every frame."
//   specs/instrumentation.md ("Snapshot shape"): "`muted` mirrors the runtime's
//   mute bit, refreshed in every frame".
//
// THE DRIVE. On the `title` the harness's opening `reset` left, because `mute`
// is read there and nothing else moves. The bit is driven to `true` by a real
// `KeyM` — two of them when the build opened muted, since the specification
// leaves the opening value to the runtime — and read back, so a build whose
// `KeyM` never set it fails on the precondition rather than passing on a bit
// that was `false` all along. Then one more `KeyM`, and the frame it is held
// across mirrors the bit into the next snapshot.
//
// WHAT IS NOT ASSERTED. That sound returned. The runtime may mute by gain or by
// silencing its sources, so only the reported bit is fixed.
//
// THE TOLERANCE. None: a boolean is an exact comparison.

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

it("reads muted false after a second KeyM", async () => {
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the presses are made from",
  );
  let armed = await pressMute(h);
  if (!armed.muted) armed = await pressMute(h);
  assertEqual(armed.muted, true, "the mute bit KeyM set, before the press");

  const after = await pressMute(h);
  await captureStill(h, "unmuted");

  assertEqual(after.muted, false, "the mute bit after KeyM pressed again");
});
