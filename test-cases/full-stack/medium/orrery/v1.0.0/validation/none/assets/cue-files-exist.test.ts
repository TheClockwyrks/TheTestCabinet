// assets/cue-files-exist — the six one-shot cues ship produced files.
//
// THE RULE, from The sound of `specs/assets.md`: "Produce a distinct sound for
// each of the six one-shot cues below, under exactly these file names, with
// `sfx-synth` or `sfx-sample` as suits each", over a table naming one file per
// cue — `assets/audio/place.wav`, `erase.wav`, `start.wav`, `halt.wav`,
// `constellation.wav` and `complete.wav`. Where the files land roots those paths:
// "Every produced file sits under `assets/` at the root of this repository, at
// the path named below, and is committed."
//
// WHY THE NAME IS THE WHOLE POINT. "under exactly these file names" is the
// sentence, and `CUE_PATHS` holds exactly them: the build asks its loader for the
// path its row names, so a sound committed under a name of the build's own
// choosing is a sound the game cannot reach, and nothing at another path stands
// in for the one the row names.
//
// WHAT THIS POINT DOES NOT READ. Whether a file decodes as a WAV, whether it
// carries signal, and whether the six are six different sounds are the three
// points after this one. This one reads that the six files are there, at those
// paths.
//
// THE EVIDENCE is what a read of each of the six came back with — its length, its
// rate and its peak, or the reason it could not be read — so a reviewer sees
// which of the six turned up.

import { it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { CUE_FILES, ONE_SHOT_CUES } from "./files";
import { readSounds, showSoundReadings, soundBytes } from "./sounds";

it("produces a file at each of the six one-shot cue paths", () => {
  showSoundReadings("cues", readSounds(CUE_FILES), CUE_FILES);

  assertLength(
    CUE_FILES,
    ONE_SHOT_CUES.length,
    "one path per one-shot cue, so the reading below is six files rather than none",
  );
  for (const [index, cue] of ONE_SHOT_CUES.entries()) {
    assertNotNull(
      soundBytes(CUE_FILES[index]),
      `the produced ${cue} cue at ${CUE_FILES[index]}`,
    );
  }
});
