// assets/cue-files-produced — all fourteen cues are produced sounds on disk,
// each a WAV carrying audible signal.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The sound"): "Produce a
// distinct sound for each of the fourteen cues below, under exactly these file
// names, with `sfx-synth` or `sfx-sample` as suits each", and its table puts
// every one under `assets/audio/` at its own cue name, from `hit.wav` to
// `hum.wav`. So per file: it is a RIFF/WAVE container, its samples are one of the
// PCM encodings the generation tools write, it holds at least one sample frame,
// and its peak clears `SILENCE_FLOOR`.
//
// THE TOLERANCE. `SILENCE_FLOOR` is a hundredth of full scale, 40 dB down, and
// `assets/sounds.ts` states why: the specification fixes no level, so what a
// check can honestly read is the difference between a sound and no sound, and a
// cue mastered as quietly as anyone would sensibly master one clears it many
// times over.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the fourteen differ from one another
// is `assets/cues-distinct`; that each PLAYS on its event is the audio category's;
// the bed is `assets/music-produced`; and every judgement of the sound bar —
// weight, palette, distinctness by ear — is the presentation domain's aesthetic
// rating.
//
// THE DRIVE. None. This point is about FILES, so it reads the repository the
// build produced and drives no game; the evidence is a sheet of what was read,
// file by file.

import { it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { writeImage } from "./media-out";
import {
  CUE_FILES,
  paintReadings,
  readingRow,
  readWavs,
  SILENCE_FLOOR,
} from "./sounds";

it("ships all fourteen cue files as WAVs carrying audible signal", () => {
  const reads = readWavs(CUE_FILES);
  writeImage(
    "cues",
    paintReadings(
      "The fourteen cue files as read",
      CUE_FILES.map((file, index) => readingRow(file, reads[index]!)),
    ),
  );

  for (const [index, file] of CUE_FILES.entries()) {
    const { wav, reason } = reads[index]!;
    if (wav === null) fail(`a WAV this reader decodes at ${file}`, reason);
    assertGreaterThan(wav.frames, 0, `sample frames in ${file}`);
    assertGreaterThan(
      wav.peak,
      SILENCE_FLOOR,
      `the peak sample of ${file}, on a full scale of 1`,
    );
  }
});
