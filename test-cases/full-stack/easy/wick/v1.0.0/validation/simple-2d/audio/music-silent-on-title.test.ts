// Wick — audio/music-silent-on-title: no `music` loop runs on any frame of
// `title` after a fresh boot.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing`, `levelup`, `chest`, or `paused` ... `title` and
//     `howto` carry no music", and "Both loops are reconciled from the state on
//     every frame".
//   - specs/ui.md (`title`): "The game opens here".
//
// WHAT IS READ. `looping("music")` after each of `LOOP_FRAMES` (60) frames of
// the title, one frame at a time, so a build that starts the loop anywhere in
// that second fails on the frame it started it. `screen` is read first, as the
// evidence that the frames walked really are title frames.
//
// WHY THE GAME IS LEFT AS IT IS. Nothing is posed at all. The harness builds
// the engine over the build's own `initialize` and runs no frame before this
// point, so the state walked is the one the game booted into, which is the
// state the requirement names. Reaching the title any other way would put a
// screen or a reset between the boot and the reading.
//
// TOLERANCE. None. The reading is a boolean, taken on each of 60 frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, createHarness, type Harness } from "../harness";
import { LOOP_FRAMES, assertLoopAcross } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("runs no music loop on any frame of the title", async () => {
  assertEqual(h.snapshot().screen, "title", "the screen a fresh boot opens on");

  await captureReplay(h, "silent", () =>
    assertLoopAcross(
      h,
      "music",
      LOOP_FRAMES,
      false,
      "music looping on the title",
    ),
  );

  assertEqual(h.snapshot().screen, "title", "the screen across the frames");
});
