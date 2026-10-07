// screens/unmute-returns-loop — toggling mute off returns the loop in place.
//
// WHAT THIS DECIDES. One thing: a second `mute` press unmutes the game with the
// looping bed still the one that was running, never restarted from its head.
// That the first press leaves the loop running is `mute-keeps-loop-looping`.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("Audio"): "A muted loop keeps looping silently and returns
//   when unmuted."
//   specs/ui.md ("The loops"): "`music` is looping on every frame exactly when
//   `screen` is `playing`, `levelup`, `chest`, or `paused`. It starts on the
//   frame a fresh run starts ... and it stops on the frame the run ends", so
//   nothing about muting is an occasion to start it again.
//   specs/controls.md ("Actions and bindings"): `mute` is `KeyM`, read on every
//   screen.
//
// THE DRIVE. An isolated `playing` run and one frame starts the bed; a first
// `KeyM` mutes; a second `KeyM` unmutes. Each press is followed by a further
// frame, because the specification requires the mirror only "every frame" and
// fixes no order within one. What is read is the mute bit, that the loop is
// still running, and how many sounds the bus has started for `music` since the
// engine was built: a build that stopped the bed and started it again on the
// unmute shows one more start than the frame that opened the run made, which is
// the same bed "returning" only in name.
//
// THE TOLERANCE. None: a boolean, whether a cue is looping, and a count of
// starts.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  soundsOf,
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

it("returns the same looping bed when mute is toggled off", async () => {
  isolate(h);
  const opened = await h.tick(1);
  assertEqual(opened.screen, "playing", "the screen the presses are made on");
  assertEqual(opened.muted, false, "the mute bit before the first KeyM");
  assertEqual(h.looping("music"), true, "music looping before the first KeyM");
  const started = soundsOf(h, "music").length;

  await tap(h, "KeyM");
  const muted = await h.tick(1);
  assertEqual(muted.muted, true, "the mute bit after the first KeyM");

  await tap(h, "KeyM");
  const after = await h.tick(1);
  captureStill(h, "returned");

  assertEqual(after.muted, false, "the mute bit after the second KeyM");
  assertEqual(h.looping("music"), true, "music looping after the second KeyM");
  assertEqual(
    soundsOf(h, "music").length,
    started,
    "sounds the bus started for music, unchanged across the mute and the unmute",
  );
});
