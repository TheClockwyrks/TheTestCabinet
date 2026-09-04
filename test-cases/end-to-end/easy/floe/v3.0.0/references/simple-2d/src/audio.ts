// Floe — audio, as engine cues (`specs/ui.md`).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute bit and the first-gesture
// unlock. The game's whole part is to DECLARE the ten cues `src/constants.ts`
// names, once, and then play them BY NAME as their events happen.
//
// Playing by name is what makes the sound legible from outside: the engine emits a
// `cue:played` event carrying the name, so "a hop was accepted and the hop cue
// played" is a fact that can be subscribed to rather than inferred from an
// oscillator starting, and a mistyped name throws instead of going quiet.
//
// The ten are pitched and shaped to be told apart by ear: a short dry tick for a
// hop, a falling gulp for the water, a hard low crack for a vehicle, a rising
// snarl for the bear, a bright two-step for a bay, a rising lift for a level, a
// clean chime for a bonus life, a long bright fanfare for victory, a deep collapse
// for the end of a run, and a small blip for a menu.

import { CUES, type CueName } from "./constants";
import type { CueSpec, InitApi } from "@test-cabinet/simple-2d";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.hop]: {
    wave: "square",
    freq: 620,
    freqTo: 880,
    gain: 0.1,
    durationMs: 40,
  },
  [CUES.splash]: {
    wave: "sine",
    freq: 520,
    freqTo: 90,
    gain: 0.22,
    durationMs: 380,
  },
  [CUES.crush]: {
    wave: "sawtooth",
    freq: 190,
    freqTo: 50,
    gain: 0.26,
    durationMs: 240,
  },
  [CUES.caught]: {
    wave: "sawtooth",
    freq: 140,
    freqTo: 420,
    gain: 0.26,
    durationMs: 320,
  },
  [CUES.bay]: {
    wave: "triangle",
    freq: 660,
    freqTo: 1320,
    gain: 0.2,
    durationMs: 180,
  },
  [CUES.levelClear]: {
    wave: "triangle",
    freq: 440,
    freqTo: 1100,
    gain: 0.22,
    durationMs: 460,
  },
  [CUES.bonusLife]: {
    wave: "sine",
    freq: 880,
    freqTo: 1760,
    gain: 0.18,
    durationMs: 260,
  },
  [CUES.victory]: {
    wave: "sine",
    freq: 560,
    freqTo: 1680,
    gain: 0.24,
    durationMs: 900,
  },
  [CUES.gameOver]: {
    wave: "sawtooth",
    freq: 240,
    freqTo: 44,
    gain: 0.24,
    durationMs: 900,
  },
  [CUES.menu]: {
    wave: "square",
    freq: 700,
    gain: 0.09,
    durationMs: 32,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
