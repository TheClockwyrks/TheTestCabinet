// screens/mute-keeps-loop-looping — muting silences a loop without stopping it.
//
// WHAT THIS DECIDES. One thing: with `music` looping, a `mute` press leaves the
// game muted with that loop still running, rather than stopping the bed to make
// silence.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md ("Audio"): "Muting and the first-gesture unlock belong to the
//   engine. The game binds the `mute` action to `api.audio.setMuted` and
//   toggles it from any screen, then mirrors `api.audio.muted()` into `muted`
//   every frame ... A muted loop keeps looping silently and returns when
//   unmuted."
//   specs/ui.md ("The loops"): "`music` is looping on every frame exactly when
//   `screen` is `playing`, `levelup`, `chest`, or `paused`", and "Both loops
//   are reconciled from the state on every frame", so a posed `playing` run has
//   the bed running one frame later.
//   specs/controls.md ("Actions and bindings"): `mute` is `KeyM`.
//
// THE DRIVE. An isolated `playing` run and one frame, which is what starts the
// bed; the loop and the mute bit are read back before the press, so a build
// that was already muted or never started the bed fails on the precondition
// rather than passing on a bit that never moved. One real `KeyM` follows, and
// one further frame, because the specification requires the mirror only "every
// frame" and fixes no order within one: a build that mirrors before it reads
// input reports the flip on the next frame, and a build that never flips
// reports it on neither.
//
// THE TOLERANCE. None: a boolean, and whether a named cue is looping.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("keeps music looping under mute", async () => {
  isolate(h);
  const before = await h.tick(1);
  assertEqual(before.screen, "playing", "the screen KeyM is pressed on");
  assertEqual(before.muted, false, "the mute bit before KeyM");
  assertEqual(h.looping("music"), true, "music looping before KeyM");

  await tap(h, "KeyM");
  const after = await h.tick(1);
  captureStill(h, "kept");

  assertEqual(after.muted, true, "the mute bit after KeyM");
  assertEqual(h.looping("music"), true, "music looping after KeyM");
});
