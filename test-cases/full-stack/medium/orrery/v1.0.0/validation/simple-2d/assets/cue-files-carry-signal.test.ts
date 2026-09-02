// assets/cue-files-carry-signal — every cue file is a sound rather than silence.
//
// THE RULE, from The sound of `specs/assets.md`: "Produce a distinct sound for
// each of the six one-shot cues below". `specs/ui.md` is what makes each of them
// audible at a moment a player is watching for — a cue is "played on the frame
// its event happens" — so a file of digital silence at one of these six paths
// gives the player nothing when the event fires, which is exactly what a produced
// cue is for.
//
// WHAT IT READS. The largest absolute sample in any channel of each file, against
// `SILENCE_FLOOR` (`0.01`), which is forty decibels below full scale.
// `specs/assets.md` fixes no LEVEL for a cue — the sound bar asks for weights
// relative to each other, which is a reviewer's judgement — so what a check can
// honestly read is the difference between a sound and no sound. A file that fails
// this carries nothing a player could hear under any mix; a cue mastered as
// quietly as anyone would sensibly master one clears it many times over.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a file whose samples
// cannot be read is not a file carrying signal. That it decodes at all is decided
// on its own by `cue-files-decode`; here it is a precondition.
//
// THE EVIDENCE is each file's peak beside the floor, with its length and rate, so
// a reviewer reads how far above silence each of the six sits.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, fail } from "../assert";
import { CUE_FILES, ONE_SHOT_CUES } from "./files";
import { SILENCE_FLOOR, readSounds, showSoundReadings } from "./sounds";

it("carries audible signal in each of the six cue files", () => {
  const reads = readSounds(CUE_FILES);
  showSoundReadings("peaks", reads, CUE_FILES);

  assertLength(
    CUE_FILES,
    ONE_SHOT_CUES.length,
    "one path per one-shot cue, so the reading below is six files rather than none",
  );
  for (const [index, cue] of ONE_SHOT_CUES.entries()) {
    const read = reads[index];
    if (read.sound === null) {
      fail(
        `a readable WAV at ${CUE_FILES[index]} for the ${cue} cue`,
        read.reason,
      );
    }
    assertGreaterThanOrEqual(
      read.sound.peak,
      SILENCE_FLOOR,
      `${cue} at ${CUE_FILES[index]}: its loudest sample, on a full scale of 1`,
    );
  }
});
