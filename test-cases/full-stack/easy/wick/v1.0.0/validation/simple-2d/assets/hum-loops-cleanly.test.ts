// Wick — assets/hum-loops-cleanly: the hum's end runs into its start, so the
// loop that holds under an aura has no click at the junction.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (Loops): "`hum` and `music` are each authored to loop
//     cleanly: the file's end runs into its start with no click, no gap, and no
//     jump in level, so in every channel the last sample and the first sample
//     differ by at most `LOOP_SEAM_TOLERANCE` (`0.01`) of full scale."
//   - specs/ui.md (The loops): "`hum` is looping on every frame exactly when
//     `screen` is `playing` and a held weapon is `halo` or `corona`", and "a
//     file-backed cue loops its decoded buffer seamlessly", so a player holding
//     Halo hears the junction again every few seconds.
//   - `constants.ts` carries the figure as `LOOP_SEAM_TOLERANCE`.
//
// WHAT IS READ. The committed `assets/audio/hum.wav` decodes, and in EVERY
// channel the absolute difference between its last sample and its first is at
// most `0.01` of full scale. A looping source plays the final sample and then
// the first, so that step is the whole of the junction, and it is read per
// channel because a click in one speaker is a click.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the file exists and carries signal is
// `assets/cue-files-produced`; when the hum loops is the audio category's; the
// bed's junction is `assets/music-loops-cleanly`.
//
// WHY NO NIGHT IS POSED. This point is about a FILE, so nothing is posed and no
// game is driven. The evidence is the junction itself: the hum's final quarter
// second drawn running into its first, with the seam marked and each channel's
// step written out.
//
// TOLERANCE. `LOOP_SEAM_TOLERANCE` is the specification's own figure, asserted
// as the bound it states rather than widened: `0.01` of full scale is already
// the tolerance around a perfect junction of `0`.

import { it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { CUE_PATHS, LOOP_SEAM_TOLERANCE } from "../constants";
import { captureCanvas } from "../harness";
import { readSound, seamOf } from "./sounds";

/** How much of each side of the junction the evidence picture shows. */
const SEAM_WINDOW_S = 0.25;

it("joins the hum's last sample to its first within a hundredth of full scale", () => {
  const read = readSound(CUE_PATHS.hum);
  if (read.sound !== null) {
    captureCanvas(
      seamOf(read.sound, `${read.file} — the loop junction`, SEAM_WINDOW_S),
      "seam",
    );
  }

  if (read.sound === null) {
    fail(`a WAV this decoder reads at ${read.file}`, read.reason);
  }
  const { channels, frames } = read.sound;
  channels.forEach((channel, index) => {
    assertLessThanOrEqual(
      Math.abs(channel[frames - 1] - channel[0]),
      LOOP_SEAM_TOLERANCE,
      `${read.file} channel ${index}: the step from its last sample to its first`,
    );
  });
});
