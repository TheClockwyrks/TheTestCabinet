// assets/cue-files-decode — every cue file is a sound rather than a name.
//
// THE RULE, from The sound of `specs/assets.md`: "Produce a distinct sound for
// each of the six one-shot cues below, under exactly these file names, with
// `sfx-synth` or `sfx-sample` as suits each", where each of those two tools
// "Produces ... a `.wav`" (The tools). So what sits at each of the six paths is a
// WAV a player can hear, and "pre-made art, a downloaded sound, or a bundled font
// standing in for a produced file does not meet this contract" — nor does an
// empty file wearing the extension.
//
// WHAT IT READS. Each file's RIFF/WAVE container: that it opens with `RIFF` and
// `WAVE`, that it carries a `fmt ` chunk this reader can honour and a `data`
// chunk, and that the samples it declares amount to a length greater than zero. A
// file that decodes to no sample frames is not a sound however well-formed its
// header is.
//
// WHY THE READER COVERS EVERY PCM SPELLING. `sfx-synth`, `sfx-sample` and `music`
// contract to write PCM `.wav` files, so the spellings a produced cue can arrive
// in are the linear-PCM spellings of the RIFF container — integer samples at 8,
// 16, 24 or 32 bits, IEEE floats at 32 or 64, and `WAVE_FORMAT_EXTENSIBLE` around
// either. `sounds.ts` reads all of them, so nothing a generator writes goes
// unread and a container carrying something else is reported AS that.
//
// WHAT THIS POINT DOES NOT READ. Whether a decoded file carries audible signal is
// the point after this one, and whether the six differ is the one after that.
//
// THE EVIDENCE is what the read came back with for each of the six — the length,
// the rate and the peak the container reported, or the reason it could not be
// read.

import { it } from "vitest";
import { assertGreaterThan, assertLength, fail } from "../assert";
import { CUE_FILES, ONE_SHOT_CUES } from "./files";
import { readSounds, showSoundReadings } from "./sounds";

it("decodes each of the six cue files as a WAV of non-zero length", () => {
  const reads = readSounds(CUE_FILES);
  showSoundReadings("cues", reads, CUE_FILES);

  assertLength(
    CUE_FILES,
    ONE_SHOT_CUES.length,
    "one path per one-shot cue, so the reading below is six files rather than none",
  );
  for (const [index, cue] of ONE_SHOT_CUES.entries()) {
    const read = reads[index];
    if (read.sound === null) {
      fail(`a WAV at ${CUE_FILES[index]} for the ${cue} cue`, read.reason);
    }
    assertGreaterThan(
      read.sound.frames,
      0,
      `${cue} at ${CUE_FILES[index]}: the sample frames the container declares`,
    );
  }
});
