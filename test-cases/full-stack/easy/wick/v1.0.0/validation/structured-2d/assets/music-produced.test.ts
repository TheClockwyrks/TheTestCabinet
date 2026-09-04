// assets/music-produced — the music bed is a committed, audible WAV with its
// score committed beside it.
//
// WHAT THIS DECIDES. Two files: `assets/audio/music.wav` is committed, reads
// as a RIFF/WAVE container the generation tools' encodings cover, holds
// sample frames, and peaks above the silence floor; and
// `assets/audio/music.mid` is committed beside it and is a MIDI file.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("The music bed"): "Produce
// the `music` cue with `music`, which may sequence the baked instrument bank,
// synth waveforms, or both: `assets/audio/music.wav`, with its
// `assets/audio/music.mid` committed beside it. The `.wav` is what the game
// plays". The tool table says the same of `music`: it produces "a `.wav` and
// a `.mid`", and the tools paragraph adds that "`music` emits a portable
// `.mid` beside the `.wav`, and both are committed". `CUE_PATHS.music` and
// `MUSIC_SCORE_PATH` in `src/constants.ts` are those two paths.
//
// HOW THE SCORE IS READ. A Standard MIDI File opens with the four bytes
// `MThd`, which is the whole of what makes a file a MIDI file rather than
// something else wearing the extension. Nothing inside it is read: the `.wav`
// is what the game plays, and the score is committed beside it as the
// portable source.
//
// WHAT IT DELIBERATELY DOES NOT READ. The bed's length is
// `assets/music-at-least-30s` and its seam is `assets/music-loops-cleanly`;
// that the game loops it for the length of a run is the audio points'
// business; and whether "the bed stays welcome for the full ten minutes" is
// the presentation domain's aesthetic rating.
//
// WHY NO WORLD IS POSED. This point is about FILES rather than about a play,
// so the game is never driven. A harness is opened only to own the canvas the
// evidence picture is painted on, and the picture is the bed's waveform.
//
// THE TOLERANCE. `SILENCE_FLOOR`, a hundredth of full scale, 40 dB down: the
// specification fixes no level, so the only figure a check can honestly read
// is the line between a bed and a silent file.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { assetFile, MUSIC_SCORE_PATH, SILENCE_FLOOR } from "../constants";
import {
  captureStill,
  createHarness,
  producedBytes,
  readWav,
  wavPeak,
  type Harness,
} from "../harness";
import { cueFile, showWaveform } from "./sounds";

/** The bed the game plays, and the score committed beside it. */
const BED = cueFile("music");
const SCORE = assetFile(MUSIC_SCORE_PATH);

/** A Standard MIDI File's header chunk id, its first four bytes. */
const MIDI_MAGIC = "MThd";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("commits an audible music bed with its .mid beside it", () => {
  const { wav, reason } = readWav(BED);
  if (wav === null) {
    fail(
      `a produced music bed committed at ${BED} (specs/assets.md, the music bed)`,
      reason,
    );
  }
  showWaveform(h, `${BED} — ${wav.duration.toFixed(2)} s`, wav);
  captureStill(h, "music");

  assertGreaterThan(wav.frames, 0, `sample frames in ${BED}`);
  assertGreaterThan(
    wavPeak(wav),
    SILENCE_FLOOR,
    `the peak sample of ${BED}, on a full scale of 1`,
  );

  const score = producedBytes(SCORE);
  if (score === null) {
    fail(
      `the bed's score committed beside it at ${SCORE} (specs/assets.md, the music bed)`,
      `no file at ${SCORE}`,
    );
  }
  if (score.toString("ascii", 0, 4) !== MIDI_MAGIC) {
    fail(
      `${SCORE} opening with a MIDI header chunk (${MIDI_MAGIC})`,
      JSON.stringify(score.toString("ascii", 0, 4)),
    );
  }
});
