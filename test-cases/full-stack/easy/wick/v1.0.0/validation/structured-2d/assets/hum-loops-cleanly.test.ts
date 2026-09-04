// assets/hum-loops-cleanly — the hum's end runs into its start without a
// step a player would hear as a click.
//
// WHAT THIS DECIDES. One reading of one file: in every channel of
// `assets/audio/hum.wav`, the last sample and the first sample differ by at
// most `LOOP_SEAM_TOLERANCE` of full scale. A looping source plays the final
// sample and then the first, so that step is the seam a player hears.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Loops"): "`hum` and
// `music` are each authored to loop cleanly: the file's end runs into its
// start with no click, no gap, and no jump in level, so in every channel the
// last sample and the first sample differ by at most `LOOP_SEAM_TOLERANCE`
// (`0.01`) of full scale." `LOOP_SEAM_TOLERANCE` in `src/constants.ts` is
// that same `0.01`. The specification states the figure itself, so the bound
// is asserted as stated.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the hum is committed and carries signal is `assets/cue-files-produced`. The other loop is the
// matching point beside this one, and that the game runs both through the
// world's `audio.loop` and `audio.stop` is the audio points' business.
//
// WHY NO WORLD IS POSED. This point is about a FILE rather than about a play,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the junction itself: the
// file's last samples on the left of the rule and its first samples on the
// right, in the order a loop plays them.
//
// THE TOLERANCE. The specification's own `0.01`, and no more. A WAV's samples
// are exact, so the reading needs no allowance of its own; the tolerance IS
// the figure the specification set.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { LOOP_SEAM_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  readWav,
  wavSeam,
  type Harness,
} from "../harness";
import { cueFile, showSeam } from "./sounds";

const LOOP = cueFile("hum");

/** How many sample frames of each side of the junction the picture shows. */
const SEAM_WINDOW = 2000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("runs the hum's end into its start with no step a player hears", () => {
  const { wav, reason } = readWav(LOOP);
  if (wav === null) {
    fail(
      `a produced loop committed at ${LOOP} whose end runs into its start (specs/assets.md, loops)`,
      reason,
    );
  }
  const seam = wavSeam(wav);
  showSeam(
    h,
    `${LOOP} — the loop junction, step ${seam.toFixed(5)}`,
    wav,
    SEAM_WINDOW,
  );
  captureStill(h, "seam");

  assertLessThanOrEqual(
    seam,
    LOOP_SEAM_TOLERANCE,
    `the largest end-to-start step across ${LOOP}'s channels, on a full scale of 1`,
  );
});
