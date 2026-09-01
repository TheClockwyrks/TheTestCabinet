// Wick — screens/mute-keeps-loop-looping: muting silences the music without
// stopping it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, Audio: "A muted loop
// keeps looping silently and returns when unmuted." `specs/ui.md`,
// "The loops": "`music` is looping on every frame exactly when `screen` is
// `playing`, `levelup`, `chest`, or `paused`", and "Both loops are reconciled
// from the state on every frame, so a state the debug surface posed sounds,
// one frame later, exactly as the same state reached by play."
// `world.audio.looping` "reports whether it is", which is what this reads.
//
// THE DRIVE. An isolated `playing` world with every driver switch off, and one
// frame, which is the frame the reconciliation starts `music` on. That the
// loop is running and the game unmuted is read as the precondition. Then one
// real `KeyM`, and the same two readings.
//
// THE TOLERANCE. None: two booleans, off the engine's own audio bus.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
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

it("reads muted with music still looping", async () => {
  isolate(h);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(before.screen, "playing", "the screen the loop is running on");
  assertEqual(before.muted, false, "muted before the press");
  assertEqual(h.looping(CUES.music), true, "music looping before the press");

  const after = await tap(h, "KeyM");
  captureStill(h, "kept");

  assertEqual(after.muted, true, "muted after KeyM");
  assertEqual(h.looping(CUES.music), true, "music looping after KeyM");
});
