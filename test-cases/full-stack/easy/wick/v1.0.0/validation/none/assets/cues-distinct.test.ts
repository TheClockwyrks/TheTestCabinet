// assets/cues-distinct — the fourteen cues are fourteen sounds.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sound"): "Produce a
// distinct sound for each of the fourteen cues below", and specs/ui.md
// ("Audio"): "The first thirteen are one-shot cues, each a distinct sound so the
// events are told apart by ear." A file shipped twice under two names is one
// sound, not two, so the review item words the floor this point reads: no two of
// the fourteen decode to identical samples.
//
// THE READING IS THE SAMPLES, NOT THE BYTES. Two containers that differ only in
// a metadata chunk carry the same sound, so the comparison is the decoded audio:
// the same rate, the same channel count, the same length, and every sample equal.
//
// THE TOLERANCE. None, and none is needed: a `.wav` carries its samples
// losslessly, so two files holding one sound differ on exactly nothing. How far
// apart two cues must SOUND — "told apart by ear" — is the sound bar and the
// presentation domain's aesthetic rating, which is a person's to make.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each file exists and carries audible
// signal is `assets/cue-files-produced`.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { fail } from "../assert";
import { writeImage } from "./media-out";
import {
  CUE_FILES,
  paintWaveGrid,
  readWavs,
  sameSamples,
  SOUND_CUES,
  type Wav,
} from "./sounds";

it("gives each of the fourteen cues samples of its own", () => {
  const reads = readWavs(CUE_FILES);
  writeImage(
    "distinct",
    paintWaveGrid(
      "The cues compared",
      SOUND_CUES.map((cue, index) => ({ label: cue, read: reads[index]! })),
    ),
  );

  const sounds: Wav[] = reads.map(
    (read, index) =>
      read.wav ??
      fail(`a WAV this reader decodes at ${CUE_FILES[index]!}`, read.reason),
  );
  for (let a = 0; a < sounds.length; a += 1) {
    for (let b = a + 1; b < sounds.length; b += 1) {
      if (sameSamples(sounds[a]!, sounds[b]!)) {
        fail(
          `${sounds[a]!.file} and ${sounds[b]!.file} decoding to different samples`,
          "the two decode to identical samples — one sound shipped under two names",
        );
      }
    }
  }
});
