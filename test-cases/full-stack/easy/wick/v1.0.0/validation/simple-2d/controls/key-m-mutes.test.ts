// controls/key-m-mutes — KeyM toggles mute back off.
//
// WHAT THIS DECIDES. One thing: `mute` is a TOGGLE, so a second `KeyM` after
// one that set `muted` true reads `muted` false again. That a first `KeyM`
// flips the bit on each screen is screens/mute-toggles-from-any-screen; this
// point is the way back.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`mute` | `KeyM` | edge |
//   toggles sound, on every screen".
//   specs/ui.md ("Audio"): "The game binds the `mute` action to
//   `api.audio.setMuted` and toggles it from any screen, then mirrors
//   `api.audio.muted()` into `muted` every frame."
//   specs/instrumentation.md ("Snapshot shape"): "`muted` mirrors the
//   runtime's mute bit, refreshed in every frame".
//   specs/state.md: `muted` is `false` on a fresh game, which is read back
//   before the first press.
//
// THE DRIVE. The title, reached through `reset`, which "leaves `muted` as it
// is" and so poses the screen without touching the bit under test. The bit is
// read false before the first press, true after it, and false after the
// second: the middle reading is the precondition the item names ("After
// `KeyM` has set `muted` true"), so a build whose first press did nothing
// fails here on the pose rather than passing on a bit that never moved. Each
// press is a REAL `KeyM` dispatched at the engine's own event target for the
// one frame that delivers its edge. The engine owns the bit and the build
// carries it into the snapshot, and the two presses drive that whole path.
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

it("reads muted false again after a second KeyM", async () => {
  h.reset();
  assertEqual(h.snapshot().muted, false, "the mute bit before any press");

  const muted = await tap(h, "KeyM");
  assertEqual(muted.muted, true, "the mute bit after the first KeyM");

  const unmuted = await tap(h, "KeyM");
  captureStill(h, "unmuted");

  assertEqual(unmuted.muted, false, "the mute bit after the second KeyM");
});
