// assets/cue-files-produced — all fourteen cue sounds are committed WAVs
// carrying signal rather than silence.
//
// WHAT THIS DECIDES. Fourteen files: `assets/audio/hit.wav`, `kill.wav`,
// `gem.wav`, `hurt.wav`, `level-up.wav`, `choose.wav`, `chest.wav`,
// `evolve.wav`, `pickup.wav`, `fallen.wav`, `dawn.wav`, `menu-move.wav`,
// `menu-confirm.wav` and `hum.wav` are committed, each reads as a RIFF/WAVE
// container whose samples are one of the encodings the generation tools
// write, each holds at least one sample frame, and each peaks above the
// silence floor.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sound"): "Produce a
// distinct sound for each of the fourteen cues below, under exactly these
// file names, with `sfx-synth` or `sfx-sample` as suits each", followed by
// the table putting every one under `assets/audio/` at its cue's own name.
// `CUE_PATHS` in `src/constants.ts` carries those same files. The bed is
// produced by a different tool and is `assets/music-produced`.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the fourteen differ from one
// another is `assets/cues-distinct`; that each is BOUND to its own file is
// `assets/cues-bound-to-their-files`; that a cue sounds on its event is the
// audio category's business; and every judgement of the sound bar — weight,
// palette, whether `hurt` is unmistakable in a crowd — is the presentation
// domain's aesthetic rating.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a play,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the table of what each
// file's container reported.
//
// THE TOLERANCE. `SILENCE_FLOOR`, a hundredth of full scale, which is 40 dB
// down. The specification fixes no level, so the only figure a check can
// honestly read is the line between a sound and no sound: a file below this
// carries nothing a player could hear under the mix, and a cue mastered as
// quietly as anyone would sensibly master one clears it many times over.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { SILENCE_FLOOR } from "../constants";
import {
  captureStill,
  createHarness,
  wavPeak,
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

it("commits all fourteen cue sounds as audible WAVs", async () => {
  const reads = readCues(CUE_SOUNDS);
  showLines(h, soundLines(reads));
  captureStill(h, "cues");

  for (const read of reads) {
    if (read.wav === null) {
      fail(
        `a produced sound committed at ${read.file} (specs/assets.md, the sound)`,
        read.reason,
      );
    }
    assertGreaterThan(read.wav.frames, 0, `sample frames in ${read.file}`);
    assertGreaterThan(
      wavPeak(read.wav),
      SILENCE_FLOOR,
      `the peak sample of ${read.file}, on a full scale of 1`,
    );
  }
});
