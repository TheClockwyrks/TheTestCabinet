// assets/cues-distinct — the fourteen cues are fourteen sounds rather than
// one sound under several names.
//
// WHAT THIS DECIDES. That no two of the fourteen committed cue files decode
// to the same samples.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sound"): "Produce a
// distinct sound for each of the fourteen cues below, under exactly these
// file names". Two files decoding to the same samples are one sound, so
// sample identity is the floor that sentence puts under the set. What each
// cue should sound like beside the others — "`hit` and `gem` ... each short
// and light; `kill` sits above `hit`", "`hurt` is unmistakable in a crowd" —
// is the sound bar, which a person judges through the presentation domain.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a play,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is what each file's
// container reported.
//
// THE TOLERANCE. None, and none is needed: a WAV stores its samples
// losslessly, so a file copied under a second name decodes to exactly the
// same numbers, while two sounds produced separately differ on their very
// first frames. That each of the fourteen exists and carries signal is
// `assets/cue-files-produced`.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  captureStill,
  createHarness,
  wavsIdentical,
  type Harness,
} from "../harness";
import { showLines } from "./produced";
import { CUE_SOUNDS, readCues, soundLines } from "./sounds";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("produces each of the fourteen cues as its own sound", async () => {
  const reads = readCues(CUE_SOUNDS);
  showLines(h, soundLines(reads));
  captureStill(h, "distinct");

  for (const read of reads) {
    if (read.wav === null) {
      fail(
        `a produced sound committed at ${read.file} (specs/assets.md, the sound)`,
        read.reason,
      );
    }
  }
  for (let a = 0; a < reads.length; a += 1) {
    for (let b = a + 1; b < reads.length; b += 1) {
      const left = reads[a];
      const right = reads[b];
      if (
        left.wav !== null &&
        right.wav !== null &&
        wavsIdentical(left.wav, right.wav)
      ) {
        fail(
          `${left.file} and ${right.file} produced as two different sounds`,
          "they decode to identical samples",
        );
      }
    }
  }
});
