// assets/beds-loop-seamlessly — each bed's end runs into its start.
//
// specs/assets.md: each bed "loops without an audible seam, the file's end
// running into its start with no click, no gap, and no jump in level". A
// looping source plays the final sample and then the first, so all three
// faults are properties of the committed samples, read at that junction:
//
// - NO CLICK: the step from the last sample to the first is a step the bed's
//   own material takes. A seam step no bigger than the largest step between
//   any two adjacent samples inside the file cannot stand out from the file;
//   a floor of 0.02 full scale (-34 dBFS) keeps a near-still pad from failing
//   on a step nobody can hear as a click.
// - NO GAP: the second surrounding the junction (final half second plus first
//   half second) carries level. A junction more than 20 dB under the bed's own
//   overall RMS (a tenth of it) is heard as a dropout.
// - NO JUMP IN LEVEL: the first second and the final second sit at the same
//   loudness within 6 dB — a doubling of perceived level at the junction is a
//   jump; ordinary bar-to-bar variation sits well inside it.
//
// The spec states the faults and not figures, so each threshold above is the
// perceptual line it names, stated here once and asserted one-directionally.

import { it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual, fail } from "../assert";
import {
  BEDS,
  maxStep,
  monoMix,
  paintSeam,
  readBed,
  rms,
  type DecodedWav,
} from "./bed-audio";
import { writeImage } from "./media-out";

const CLICK_FLOOR = 0.02;
const GAP_SHARE = 0.1;
const LEVEL_JUMP_DB = 6;
const SEAM_WINDOW_S = 0.5;
const LEVEL_WINDOW_S = 1;

function decodeOrFail(name: string, path: string): DecodedWav {
  try {
    return readBed(path);
  } catch (error) {
    return fail(
      `${path} committed and decoding as a WAV whose end runs into its start`,
      `${name} did not decode: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertSeamless(outputId: string, name: string, path: string): void {
  const wav = decodeOrFail(name, path);
  writeImage(outputId, paintSeam(`${name} — the loop junction`, wav, SEAM_WINDOW_S));

  // No click, read on every channel: a click in one speaker is a click.
  for (const [index, channel] of wav.channels.entries()) {
    const seamStep = Math.abs(channel[0] - channel[wav.frames - 1]);
    assertLessThanOrEqual(
      seamStep,
      Math.max(maxStep(channel), CLICK_FLOOR),
      `${path} channel ${index}: the end-to-start step is one the bed's own material takes (no click)`,
    );
  }

  const mono = monoMix(wav);
  const whole = rms(mono);
  const seamWindow = Math.min(
    Math.round(SEAM_WINDOW_S * wav.sampleRate),
    Math.floor(wav.frames / 2),
  );
  const seamLevel = Math.sqrt(
    (rms(mono, 0, seamWindow) ** 2 +
      rms(mono, wav.frames - seamWindow, wav.frames) ** 2) /
      2,
  );
  assertGreaterThanOrEqual(
    seamLevel,
    whole * GAP_SHARE,
    `${path}: the second around the junction carries level (no gap)`,
  );

  const levelWindow = Math.min(
    Math.round(LEVEL_WINDOW_S * wav.sampleRate),
    Math.floor(wav.frames / 2),
  );
  const head = rms(mono, 0, levelWindow);
  const tail = rms(mono, wav.frames - levelWindow, wav.frames);
  const jumpDb = Math.abs(
    20 * Math.log10(Math.max(head, 1e-6) / Math.max(tail, 1e-6)),
  );
  assertLessThanOrEqual(
    jumpDb,
    LEVEL_JUMP_DB,
    `${path}: the level across the junction, in dB (no jump in level)`,
  );
}

it("loops the title bed without an audible seam", () => {
  assertSeamless("title-seam", BEDS[0].name, BEDS[0].path);
});

it("loops the play bed without an audible seam", () => {
  assertSeamless("play-seam", BEDS[1].name, BEDS[1].path);
});
