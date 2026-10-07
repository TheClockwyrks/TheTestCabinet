// Wick — assets/cue-files-produced: all fourteen cue files are committed
// sounds, each a WAV carrying audible signal.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sound): "Produce a distinct sound for each of the
//     fourteen cues below, under exactly these file names, with `sfx-synth` or
//     `sfx-sample` as suits each", and the table putting every one under
//     `assets/audio/` at its cue's name, from `hit.wav` to `hum.wav`.
//   - specs/assets.md (Where the files land): "Every produced file sits under
//     `assets/` at the root of this repository, at the path named below, and is
//     committed."
//   - `constants.ts` carries the paths as `CUE_PATHS`, keyed by the cue names
//     `specs/ui.md` fixes.
//
// WHAT IS READ. Each of the fourteen files exists at its own name, decodes as a
// RIFF/WAVE container this project's decoder can read, holds at least one
// sample frame, and peaks above `SILENCE_FLOOR` — a hundredth of full scale,
// forty decibels down, the honest line between a sound and no sound. The bed's
// `music.wav` is `assets/music-produced`, so it is not among the fourteen.
//
// WHAT IT DELIBERATELY DOES NOT READ. That no two cues are the same sound is
// `assets/cues-distinct`; that each cue plays the file of its own name is
// `assets/cues-bound-to-their-files`; that a cue sounds on its event is the
// audio category's; and every judgement of the sound bar — weight, palette,
// telling one from another by ear — is the presentation domain's rating.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is a sheet of what was read: one row per file,
// with its length, rate, channels, peak, and envelope.
//
// TOLERANCE. `SILENCE_FLOOR` is the only figure, and it is a floor rather than
// a target: `specs/assets.md` fixes no level, so what a check can honestly read
// is that a file carries something a player could hear.

import { it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { CUE_PATHS } from "../constants";
import { captureCanvas } from "../harness";
import { CUE_FILES, SILENCE_FLOOR, readSounds, sheetOfSounds } from "./sounds";

it("commits all fourteen cue files as WAVs carrying audible signal", () => {
  const reads = readSounds(CUE_FILES.map((cue) => CUE_PATHS[cue]));

  captureCanvas(
    sheetOfSounds(reads, "assets/audio — the fourteen cue files as read"),
    "cues",
  );

  for (const read of reads) {
    if (read.sound === null) {
      fail(`a WAV this decoder reads at ${read.file}`, read.reason);
    }
    assertGreaterThan(read.sound.frames, 0, `sample frames in ${read.file}`);
    assertGreaterThan(
      read.sound.peak,
      SILENCE_FLOOR,
      `the peak sample of ${read.file}, on a full scale of 1`,
    );
  }
});
