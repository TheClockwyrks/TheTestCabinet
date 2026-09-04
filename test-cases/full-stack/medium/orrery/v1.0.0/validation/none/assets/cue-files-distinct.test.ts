// assets/cue-files-distinct — six cues, six sounds.
//
// THE RULE, from The sound of `specs/assets.md`: "Produce a DISTINCT sound for
// each of the six one-shot cues below, under exactly these file names". The sound
// bar says why, event by event: "`place` and `erase` fire many times a minute
// while a machine is built, so each is short and light, and `erase` is told from
// `place` by ear", and "`halt` is unmistakable as failure and `complete` as
// success, and neither is heard as the other".
//
// WHAT IT READS. The decoded samples of all six files, compared pairwise. Two
// files are the same clip when they carry the same channels, the same length and
// the same samples to within `SAMPLE_EPSILON` — one step of a sixteen-bit
// container, which is the only honest way the same material can be written twice
// and not be the same numbers. A PCM `.wav` carries its samples exactly, so one
// clip shipped under two names differs by nothing at all.
//
// WHY THE SAMPLES AND NOT THE BYTES. A file rewritten with a different chunk
// layout, or with a `LIST` of metadata added, is byte for byte another file and
// is note for note the same sound; a comparison of bytes would pass a build that
// shipped one clip six times through a tool that stamped each with its name.
//
// WHAT IT DOES NOT DECIDE. Whether two cues are told apart BY EAR, and whether
// they carry the weights the sound bar asks for, are the bar itself and are the
// reviewer's judgement. This point decides only that six sounds were made rather
// than one repeated.
//
// A FILE THAT WILL NOT DECODE FAILS THIS POINT, because a file whose samples
// cannot be read is not one of six distinct clips. That it decodes at all is
// decided on its own by `cue-files-decode`; here it is a precondition.
//
// THE EVIDENCE is the six waveforms stacked one above another, so the pairs are
// compared by eye beside the verdict.

import { it } from "vitest";
import { assertLength, fail } from "../assert";
import { readClip, sameClip, showClips, type ClipRead } from "./clips";
import { CUE_FILES, ONE_SHOT_CUES } from "./files";

it("ships a different clip for each of the six one-shot cues", () => {
  const reads: ClipRead[] = ONE_SHOT_CUES.map((cue, index) =>
    readClip(`${cue} cue`, CUE_FILES[index]),
  );
  showClips("cues", reads);

  assertLength(
    CUE_FILES,
    ONE_SHOT_CUES.length,
    "one path per one-shot cue, so the pairs below are the six cues'",
  );
  for (const read of reads) {
    if (read.clip === null) fail(`a decoded ${read.label}`, read.reason);
  }

  // Reported with `fail` rather than compared with an assertion over the samples
  // themselves: what a reviewer needs to read is which two cues carry one clip,
  // not two seconds of audio twice.
  for (let i = 0; i < reads.length; i += 1) {
    for (let j = i + 1; j < reads.length; j += 1) {
      const left = reads[i].clip;
      const right = reads[j].clip;
      if (left !== null && right !== null && sameClip(left, right)) {
        fail(
          `${reads[i].file} and ${reads[j].file} to carry different clips`,
          `both carry the same ${left.frames} sample frames at ${left.sampleRate} Hz`,
        );
      }
    }
  }
});
