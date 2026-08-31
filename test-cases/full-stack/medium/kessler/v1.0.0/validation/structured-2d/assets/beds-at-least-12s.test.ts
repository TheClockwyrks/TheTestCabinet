// assets/beds-at-least-12s — each bed runs at least twelve seconds.
//
// specs/assets.md: "Each bed runs at least 12 seconds and loops without an
// audible seam". This suite decides the length half alone: the duration each
// committed `.wav` announces — sample frames over sample rate — is at least
// 12 seconds. The seam belongs to `beds-loop-seamlessly`.
//
// THE TOLERANCE IS ONE HUNDREDTH OF A SECOND. The figure is stated in whole
// seconds, and a WAV's length is quantized to whole sample frames, so a bed
// rendered AT twelve seconds can land a frame short of the exact float. A
// hundredth of a second absorbs any such rounding while still failing any bed
// that is actually shorter than the figure.

import { it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { BEDS, paintWaveform, readBed, type DecodedWav } from "./bed-audio";
import { writeImage } from "./media-out";

const MIN_SECONDS = 12;
const ROUNDING = 0.01;

function decodeOrFail(name: string, path: string): DecodedWav {
  try {
    return readBed(path);
  } catch (error) {
    return fail(
      `${path} committed and decoding as a WAV at least ${MIN_SECONDS} seconds long`,
      `${name} did not decode: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertLongEnough(outputId: string, name: string, path: string): void {
  const wav = decodeOrFail(name, path);
  writeImage(
    outputId,
    paintWaveform(
      `${name} — ${wav.duration.toFixed(2)} s against the 12 s floor`,
      wav,
      MIN_SECONDS,
    ),
  );
  assertGreaterThanOrEqual(
    wav.duration,
    MIN_SECONDS - ROUNDING,
    `${path} runs at least ${MIN_SECONDS} seconds`,
  );
}

it("runs the title bed at least twelve seconds", () => {
  assertLongEnough("title-length", BEDS[0].name, BEDS[0].path);
});

it("runs the play bed at least twelve seconds", () => {
  assertLongEnough("play-length", BEDS[1].name, BEDS[1].path);
});
