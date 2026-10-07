// Floe — audio, as runtime cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// runtime (`src/audio-bus.ts`) owns the audio context, the synthesis, the mute
// bit and the first-gesture unlock. The game's whole part is to DECLARE the ten
// cues `specs/ui.md` names, once, and then play them BY NAME as the events happen.
//
// The ten are pitched and shaped to be told apart by ear: a short bright blip for
// a hop, a falling gulp for a splash, a hard low crack for a crush, a snarling
// drop for a catch, a rising chime for a bay, a longer fanfare for a level, a
// bright arpeggio-ish sweep for a bonus life, a long rise for victory, a long
// fall for the run's end, and a soft tick for a menu move.

import { CUES, type CueName } from "./constants";
import type { CueSpec } from "./audio-bus";
import type { InitApi } from "./runtime";

/** The synthesis behind each of the ten cues. */
export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.hop]: {
    wave: "square",
    freq: 520,
    freqTo: 760,
    gain: 0.14,
    durationMs: 60,
  },
  [CUES.splash]: {
    wave: "sine",
    freq: 420,
    freqTo: 90,
    gain: 0.22,
    durationMs: 320,
  },
  [CUES.crush]: {
    wave: "sawtooth",
    freq: 190,
    freqTo: 55,
    gain: 0.24,
    durationMs: 260,
  },
  [CUES.caught]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 70,
    gain: 0.26,
    durationMs: 420,
  },
  [CUES.bay]: {
    wave: "triangle",
    freq: 480,
    freqTo: 960,
    gain: 0.2,
    durationMs: 220,
  },
  [CUES.levelClear]: {
    wave: "triangle",
    freq: 340,
    freqTo: 1020,
    gain: 0.22,
    durationMs: 520,
  },
  [CUES.bonusLife]: {
    wave: "square",
    freq: 660,
    freqTo: 1320,
    gain: 0.18,
    durationMs: 300,
  },
  [CUES.victory]: {
    wave: "triangle",
    freq: 260,
    freqTo: 1560,
    gain: 0.24,
    durationMs: 900,
  },
  [CUES.gameOver]: {
    wave: "sine",
    freq: 420,
    freqTo: 60,
    gain: 0.24,
    durationMs: 900,
  },
  [CUES.menu]: {
    wave: "square",
    freq: 300,
    gain: 0.1,
    durationMs: 40,
  },
};

/** Declare every cue, once, before the first tick. */
export function defineCues(api: InitApi): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
