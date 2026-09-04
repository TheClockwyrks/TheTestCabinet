// assets/beds-produced — both music beds ship as produced tracks.
//
// specs/assets.md: "Produce two beds with `music` ... `music` writes a `.wav`
// and a `.mid` beside it; the `.wav` is what the game plays", and its table
// lands them at `assets/audio/music-title.wav` and `assets/audio/music-play.wav`.
// The item reads exactly that off the committed files: each exists, decodes as
// a WAV, and carries audible signal rather than silence.
//
// THE SILENCE LINE IS A TOLERANCE. The spec fixes no level, only that a bed is
// a produced track the game plays, so the reading only rules out silence: a
// peak at or under 1% of full scale (-40 dBFS) with an RMS at or under 0.1% is
// a file nobody would hear under the cues, not a quiet mix. Any actual music
// clears both by orders of magnitude.

import { it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { BEDS, peak, readBed, rms, paintWaveform, type DecodedWav } from "./bed-audio";
import { writeImage } from "./media-out";

/** Peak at or under this share of full scale reads as silence, not signal. */
const SILENCE_PEAK = 0.01;
const SILENCE_RMS = 0.001;

function decodeOrFail(name: string, path: string): DecodedWav {
  try {
    return readBed(path);
  } catch (error) {
    return fail(
      `${path} committed and decoding as a WAV (specs/assets.md, the music beds)`,
      `${name} did not decode: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertAudible(outputId: string, name: string, path: string): void {
  const wav = decodeOrFail(name, path);
  writeImage(outputId, paintWaveform(`${name} — ${path}`, wav));
  assertGreaterThan(wav.frames, 0, `${path} holds sample frames`);
  const loudest = Math.max(...wav.channels.map((channel) => peak(channel)));
  const level = Math.max(...wav.channels.map((channel) => rms(channel)));
  assertGreaterThan(
    loudest,
    SILENCE_PEAK,
    `${path} peak amplitude — audible signal rather than silence`,
  );
  assertGreaterThan(
    level,
    SILENCE_RMS,
    `${path} RMS level — audible signal rather than silence`,
  );
}

it("ships the title bed as a produced, audible WAV", () => {
  assertAudible("title-bed", BEDS[0].name, BEDS[0].path);
});

it("ships the play bed as a produced, audible WAV", () => {
  assertAudible("play-bed", BEDS[1].name, BEDS[1].path);
});
