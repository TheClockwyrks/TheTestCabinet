// assets/bed-carries-signal — the bed is a sound rather than silence.
//
// THE RULE. `specs/assets.md` asks for the bed to be produced with `music` and
// `specs/ui.md` runs it under the whole game — "`music` is looping on every frame
// the game runs" — so a file of digital silence at `assets/audio/music.wav`
// leaves a player who has the game running and the volume up hearing nothing at
// all, which is exactly what the bed is for.
//
// WHAT IT READS. The largest absolute sample in any channel of the whole file,
// against `SILENCE_FLOOR` (`0.01`), which is forty decibels below full scale.
//
// WHY THE WHOLE FILE AND NOT EACH BAR OF IT. `specs/assets.md` fixes no level for
// the bed — the sound bar asks only that it "sits under the cues", which is a
// weight relative to them and a reviewer's judgement — and music legitimately
// rests: a bar of silence inside a thirty-second loop is a musical choice the
// specification leaves open, so a check reading each second against a floor would
// fail a conformant bed for it. What a check can honestly read is the difference
// between a bed and no bed, and that is read over the file's length.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a file whose samples
// cannot be read is not a file carrying signal. That it decodes at all is decided
// on its own by `bed-file-decodes`; here it is a precondition.
//
// THE EVIDENCE is the bed's waveform, whose envelope shows where in its length
// the level sits, beside the peak the verdict read.

import { it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { peak } from "./bed-audio";
import { readClip, showClips } from "./clips";
import { BED_FILE } from "./files";
import { SILENCE_FLOOR } from "./sounds";

it("carries audible signal in the produced music bed", () => {
  const read = readClip("music bed", BED_FILE);
  showClips("peak", [read]);

  if (read.clip === null) fail(`a readable WAV at ${BED_FILE}`, read.reason);
  const loudest = Math.max(
    ...read.clip.channels.map((channel) => peak(channel)),
  );
  assertGreaterThanOrEqual(
    loudest,
    SILENCE_FLOOR,
    `${BED_FILE}: its loudest sample in any channel, on a full scale of 1`,
  );
});
