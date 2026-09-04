// assets/bed-file-decodes — the bed is a sound rather than a name.
//
// THE RULE, from The music bed of `specs/assets.md`: "Produce the `music` cue
// with `music` ... `assets/audio/music.wav`", where `music` "Produces ...
// sequenced music over a baked instrument bank, a `.wav` and a `.mid`" (The
// tools). So what sits at that path is a WAV the game can play, and "pre-made
// art, a downloaded sound, or a bundled font standing in for a produced file does
// not meet this contract" — nor does an empty file wearing the extension.
//
// WHAT IT READS. The file's RIFF/WAVE container, decoded to its channels: that it
// opens with `RIFF` and `WAVE`, that its `fmt ` chunk names a format and a rate
// this reader can honour, that it carries a `data` chunk, and that the samples
// amount to a length greater than zero. A file that decodes to no sample frames
// is not a bed however well-formed its header is.
//
// WHY THE READER COVERS EVERY PCM SPELLING. `music` contracts to write a PCM
// `.wav`, so the spellings the bed can arrive in are the linear-PCM spellings of
// the RIFF container — integer samples at 8, 16, 24 or 32 bits, IEEE floats at 32
// or 64, and `WAVE_FORMAT_EXTENSIBLE` around either. `bed-audio.ts` reads all of
// them, so nothing the tool writes goes unread.
//
// WHAT THIS POINT DOES NOT READ. Whether the decoded bed carries signal, runs
// long enough, or loops without a seam are the points after this one.
//
// THE EVIDENCE is the decoded bed as a waveform, labelled with the length, rate
// and channel count the decode reported — or the reason the decode failed.

import { it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { readClip, showClips } from "./clips";
import { BED_FILE } from "./files";

it("decodes assets/audio/music.wav as a WAV of non-zero length", () => {
  const read = readClip("music bed", BED_FILE);
  showClips("bed-decodes", [read]);

  if (read.clip === null) fail(`a WAV at ${BED_FILE}`, read.reason);
  assertGreaterThan(
    read.clip.frames,
    0,
    `${BED_FILE}: the sample frames the decode read out of it`,
  );
});
