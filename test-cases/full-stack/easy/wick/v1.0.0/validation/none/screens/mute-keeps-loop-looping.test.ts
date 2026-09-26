// screens/mute-keeps-loop-looping — muting silences a running loop without
// stopping it.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "Muting silences a
// running loop without stopping it, and the loop returns in place when
// unmuted." The loop it is read on is the bed: "`music` is looping on every
// frame exactly when `screen` is `playing`, `levelup`, `chest`, or `paused`. It
// starts on the frame a fresh run starts" (specs/ui.md — "The loops"), and "A
// looping cue sounds through a single source set to loop, from the frame that
// starts it until the frame that stops it". So a run under `KeyM` reads `muted`
// true with that source still running.
//
// WHY THE WORLD IS POSED AS IT IS. The harness is CREATED armed, so the real
// browser gesture — a key bound to nothing — is in before the check begins,
// because a build is free to open its audio from a real DOM event and a bed
// that never started could not be silenced. It cannot be asked for later: the
// gesture lands before the harness's opening `reset`, and that restore is what
// puts back whatever a real browser event moved. An isolated night is then
// opened and one frame run, since "Both loops are reconciled from the state on
// every frame", and the bed is read as running BEFORE the press so that a build
// with no bed at all fails on the precondition rather than passing on silence.
// The press is a REAL `KeyM` held across exactly one frame, and the bed is read
// on that frame AND on the frame after it, because a build is free to mirror
// its mute bit at any point in a frame: "`music` is looping on every frame
// exactly when `screen` is `playing`" holds on every frame the mute stands, not
// only on the one that raised it, so a build that drops the bed a frame later
// fails here rather than passing on the frame the press was read in.
//
// THE TOLERANCE. None: whether a source is looping and whether `muted` is set
// are both exact readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  isLooping,
  pressMute,
  type Harness,
} from "../harness";
import { night } from "./stage";

/** The cue the bed plays under, one of the two in `LOOPING_CUES`. */
const MUSIC = "music";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("reads muted with the bed still looping after KeyM", async () => {
  const playing = await night(h);
  assertEqual(playing.muted, false, "muted before the press");
  await h.step(1);
  assertTrue(await isLooping(h, MUSIC), "the bed looping before the press");

  const muted = await pressMute(h);
  await captureStill(h, "kept");

  assertEqual(muted.muted, true, "muted after KeyM");
  assertTrue(
    await isLooping(h, MUSIC),
    "the bed still looping on the frame the mute was read on",
  );
  await h.step(1);
  assertTrue(
    await isLooping(h, MUSIC),
    "the bed still looping on the frame after the mute",
  );
});
