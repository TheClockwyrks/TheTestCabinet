// Wick — assets/cues-distinct: the fourteen cues are fourteen sounds rather
// than one sound shipped under several names.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (The sound): "Produce a distinct sound for each of the
//     fourteen cues below, under exactly these file names."
//   - specs/ui.md (Audio): "The first thirteen are one-shot cues, each a
//     distinct sound so the events are told apart by ear."
//   - The review item states the floor read here: "No two of the fourteen cue
//     files decode to identical samples."
//
// WHAT IS READ. The ninety-one pairs the fourteen files make, compared sample
// for sample after decoding: the same rate, the same channel count, the same
// length, and every sample equal is one sound under two names. Two events
// carrying the same samples cannot be told apart by ear at all, which is the
// far side of "told apart by ear"; whether two sounds that DO differ are
// distinguishable enough is the sound bar the presentation domain's rating
// judges.
//
// WHY THE SAMPLES RATHER THAN THE BYTES. A `.wav` carries metadata chunks and a
// header a tool is free to write differently on two runs, so two files that
// hold the same sound need not hold the same bytes. What a player hears is the
// samples, so the samples are what is compared.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each file exists and carries signal
// is `assets/cue-files-produced`; the bed is `assets/music-produced`.
//
// WHY NO NIGHT IS POSED. This point is about FILES, so nothing is posed and no
// game is driven. The evidence is a sheet of the fourteen as read, envelopes
// side by side.
//
// TOLERANCE. None. Sample equality is exact.

import { it } from "vitest";
import { fail } from "../assert";
import { CUE_PATHS } from "../constants";
import { captureCanvas } from "../harness";
import {
  CUE_FILES,
  readSounds,
  sameSamples,
  sheetOfSounds,
  type Sound,
} from "./sounds";

it("gives each of the fourteen cues samples of its own", () => {
  const reads = readSounds(CUE_FILES.map((cue) => CUE_PATHS[cue]));

  captureCanvas(
    sheetOfSounds(reads, "assets/audio — the fourteen cues compared"),
    "distinct",
  );

  const sounds: Sound[] = reads.map((read) => {
    if (read.sound === null) {
      fail(`a WAV this decoder reads at ${read.file}`, read.reason);
    }
    return read.sound;
  });

  for (let a = 0; a < sounds.length; a += 1) {
    for (let b = a + 1; b < sounds.length; b += 1) {
      if (sameSamples(sounds[a], sounds[b])) {
        fail(
          "fourteen cue files, no two of them the same sound",
          `${sounds[a].file} and ${sounds[b].file} decode to identical samples`,
        );
      }
    }
  }
});
