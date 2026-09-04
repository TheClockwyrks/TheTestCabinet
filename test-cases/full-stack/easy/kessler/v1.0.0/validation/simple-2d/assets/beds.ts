// assets/beds — the readings the three per-bed points share.
//
// specs/assets.md's music-bed table lands the two produced tracks at
// `assets/audio/music-title.wav` and `assets/audio/music-play.wav`, and states
// three separate things about each: that it is produced with `music` and is what
// the game plays, that it "runs at least 12 seconds", and that it "loops without
// an audible seam, the file's end running into its start with no click, no gap,
// and no jump in level".
//
// Each of those is a point per bed, because a build that produced one bed and
// not the other, or whose play bed alone is a two-second stub, must grade
// differently from one that missed both. The readings live here so the six thin
// suites state only which bed they are about.
//
// EVERY THRESHOLD BELOW IS A TOLERANCE, NOT A SPEC FIGURE. The specification
// names the faults — silence, a click, a gap, a jump in level — and no numbers
// for them, so each line here is the perceptual bar that fault names, stated
// once. The one genuine spec figure, the twelve seconds, comes from the
// project's own `constants.ts`.

import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { MUSIC_MIN_SECONDS } from "../constants";
import {
  maxStep,
  monoMix,
  paintSeam,
  paintWaveform,
  peak,
  readBed,
  rms,
  type DecodedWav,
} from "./bed-audio";
import { writeImage } from "./media-out";

/** Peak at or under this share of full scale reads as silence, not signal. */
const SILENCE_PEAK = 0.01;
const SILENCE_RMS = 0.001;

/**
 * How much a length may fall short of the figure. A WAV's length is quantized
 * to whole sample frames, so a bed rendered AT twelve seconds can land a frame
 * short of the exact float; a hundredth of a second absorbs that and still
 * fails any bed actually shorter than the figure.
 */
const ROUNDING = 0.01;

/** A seam step no larger than this is below what anyone hears as a click. */
const CLICK_FLOOR = 0.02;
/** A junction more than 20 dB under the bed's own RMS is heard as a dropout. */
const GAP_SHARE = 0.1;
/** A doubling of perceived level across the junction is a jump. */
const LEVEL_JUMP_DB = 6;
const SEAM_WINDOW_S = 0.5;
const LEVEL_WINDOW_S = 1;

function decodeOrFail(
  name: string,
  path: string,
  requirement: string,
): DecodedWav {
  try {
    return readBed(path);
  } catch (error) {
    return fail(
      `${path} committed and ${requirement}`,
      `${name} did not decode: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** The bed exists, decodes as a WAV, and carries audible signal. */
export function assertAudible(
  outputId: string,
  name: string,
  path: string,
): void {
  const wav = decodeOrFail(name, path, "decoding as a WAV");
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

/** The bed runs at least the figure specs/assets.md states. */
export function assertLongEnough(
  outputId: string,
  name: string,
  path: string,
): void {
  const wav = decodeOrFail(
    name,
    path,
    `decoding as a WAV at least ${MUSIC_MIN_SECONDS} seconds long`,
  );
  writeImage(
    outputId,
    paintWaveform(
      `${name} — ${wav.duration.toFixed(2)} s against the ` +
        `${MUSIC_MIN_SECONDS} s floor`,
      wav,
      MUSIC_MIN_SECONDS,
    ),
  );
  assertGreaterThanOrEqual(
    wav.duration,
    MUSIC_MIN_SECONDS - ROUNDING,
    `${path} runs at least ${MUSIC_MIN_SECONDS} seconds`,
  );
}

/** The bed's end runs into its start with no click, no gap, no level jump. */
export function assertSeamless(
  outputId: string,
  name: string,
  path: string,
): void {
  const wav = decodeOrFail(
    name,
    path,
    "decoding as a WAV whose end runs into its start",
  );
  writeImage(
    outputId,
    paintSeam(`${name} — the loop junction`, wav, SEAM_WINDOW_S),
  );

  // No click, read on every channel: a click in one speaker is a click.
  for (const [index, channel] of wav.channels.entries()) {
    const seamStep = Math.abs(channel[0] - channel[wav.frames - 1]);
    assertLessThanOrEqual(
      seamStep,
      Math.max(maxStep(channel), CLICK_FLOOR),
      `${path} channel ${index}: the end-to-start step is one the bed's own ` +
        `material takes (no click)`,
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
