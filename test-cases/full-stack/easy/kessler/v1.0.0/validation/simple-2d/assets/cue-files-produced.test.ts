// assets/cue-files-produced — all thirteen cues are produced sounds on disk,
// each a WAV carrying audible signal.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` says "Produce a distinct
// sound for each of the thirteen cues, under exactly these file names", and
// its table puts every one under `assets/audio/` at its cue name — from
// `paddle-bounce.wav` to `menu-select.wav` — made with `sfx-synth` or
// `sfx-sample`. The review item reads exactly that: each file exists at its
// name, "decodes as a WAV of non-zero length carrying audible signal rather
// than silence". So per file: it is a RIFF/WAVE container, its samples are one
// of the PCM encodings the generation tools write, it holds at least one
// sample frame, and its peak clears `SILENCE_FLOOR` (40 dB down, the honest
// line between a sound and no sound — see `assets/sounds.ts`).
//
// WHAT IT DELIBERATELY DOES NOT READ. That each cue PLAYS on its event is the
// audio category's own points; the two music beds are `assets/beds-produced`;
// and every judgement of the sound bar — distinctness by ear, weight, palette
// — is the presentation domain's aesthetic rating.
//
// THE EVIDENCE. This point drives no game, so its declared still is a sheet of
// what was read: one row per cue file, with the length and peak its container
// reported.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, fail } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import {
  CUE_FILES,
  readSounds,
  showSoundReadings,
  SILENCE_FLOOR,
} from "./sounds";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ships all thirteen cue files as WAVs carrying audible signal", async () => {
  const reads = readSounds(CUE_FILES);
  showSoundReadings(h, reads, CUE_FILES);
  captureStill(h, "cues");

  for (let i = 0; i < CUE_FILES.length; i += 1) {
    const file = CUE_FILES[i];
    const { sound, reason } = reads[i];
    if (sound === null) {
      fail(`a WAV this reader decodes at ${file}`, reason);
    }
    assertGreaterThan(sound.frames, 0, `sample frames in ${file}`);
    assertGreaterThan(
      sound.peak,
      SILENCE_FLOOR,
      `the peak sample of ${file}, on a full scale of 1`,
    );
  }
});
