// controls/key-m-mutes — KeyM toggles mute back off.
//
// WHAT THIS DECIDES. One thing: with the game muted by one `KeyM`, a second
// `KeyM` reads `muted` `false` again, so `mute` is a toggle rather than a
// one-way switch. That the first press mutes is the precondition, read back
// before the press under test.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`mute` | `KeyM` | edge |
//   toggles sound, on every screen".
//   specs/ui.md ("Audio"): "The game binds the `mute` action to
//   `world.audio.setMuted` and toggles it from any screen, then mirrors
//   `world.audio.muted()` into `muted` every frame."
//   specs/instrumentation.md ("Snapshot shape"): "`muted` mirrors the
//   runtime's mute bit, refreshed in every frame".
//
// THE DRIVE. `reset` leaves the game on the title, one of the screens the
// table reads `mute` on, and `muted` as it stands; the bit is read back
// `false` before anything is pressed so a build that booted muted fails on
// that line rather than passing on a bit that only ever moved once. Each
// press is a REAL `KeyM` dispatched at the engine's input seam and delivered
// by one frame, released between the two so each is its own edge. What is
// read is the REPORTED bit, which the specification fixes; whether the bus
// went quiet and came back is the reviewer's, by ear.
//
// THE TOLERANCE. None: a boolean is an exact comparison.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, tap, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads muted false after a second KeyM follows the first", async () => {
  h.reset();
  assertEqual(h.snapshot().muted, false, "the mute bit before any press");
  const muted = await tap(h, "KeyM");
  assertEqual(muted.muted, true, "the mute bit after the first KeyM");

  const unmuted = await tap(h, "KeyM");
  captureStill(h, "unmuted");

  assertEqual(unmuted.muted, false, "the mute bit after the second KeyM");
});
