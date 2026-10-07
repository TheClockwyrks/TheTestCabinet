// assets/hum-loops-cleanly — the hum's end runs into its start.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Loops"): "`hum` and `music`
// are each authored to loop cleanly: the file's end runs into its start with no
// click, no gap, and no jump in level, so in every channel the last sample and
// the first sample differ by at most `LOOP_SEAM_TOLERANCE` (`0.01`) of full
// scale." A looping source plays the final sample and then the first, so the
// junction is a property of the committed samples and is read there: in every
// channel, the distance between the two.
//
// THE TOLERANCE. `LOOP_SEAM_TOLERANCE` itself, which the specification states as
// the bound rather than as a target, so the reading needs no allowance of its
// own: a sample decoded from integer PCM is exact, and a loop authored to the
// figure sits at or under it. Every channel is read, because a click in one
// speaker is a click.
//
// WHAT IT DELIBERATELY DOES NOT READ. The bed's seam is
// `assets/music-loops-cleanly`; that `hum` exists and carries audible signal is
// `assets/cue-files-produced`; that the loop runs exactly while Halo or Corona is
// held on `playing` is the audio category's.
//
// THE DRIVE. None. This point is about a FILE, so it reads the repository the
// build produced and drives no game.

import { it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { LOOP_SEAM_TOLERANCE } from "../constants";
import { writeImage } from "./media-out";
import { HUM_FILE, paintSeam, readWav } from "./sounds";

/** How much of either end the seam picture shows, in seconds. */
const SEAM_WINDOW_S = 0.5;

it("joins the hum's last sample to its first within a hundredth", () => {
  const read = readWav(HUM_FILE);
  const wav =
    read.wav ??
    fail(
      `${HUM_FILE} committed and decoding as a WAV whose end runs into its start`,
      read.reason,
    );
  writeImage(
    "seam",
    paintSeam(`${HUM_FILE} — the loop junction`, wav, SEAM_WINDOW_S),
  );

  if (wav.frames < 2) {
    fail(`${HUM_FILE} holding a first and a last sample`, wav.frames);
  }
  for (const [index, channel] of wav.channels.entries()) {
    assertLessThanOrEqual(
      Math.abs(channel[0]! - channel[wav.frames - 1]!),
      LOOP_SEAM_TOLERANCE,
      `${HUM_FILE} channel ${index}: the distance from its last sample to its first, on a full scale of 1`,
    );
  }
});
