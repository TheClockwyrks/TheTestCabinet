// Cascade — audio, as engine cues (`specs/audio.md`).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute bit and the
// first-gesture unlock. The game's whole part is to DECLARE the ten cues
// `src/constants.ts` names, once, and then play them by name as their events
// happen.
//
// Playing by name is what makes the sound legible from outside: the engine emits
// a `cue:played` event carrying the name, so "the stock was turned and the turn
// cue played" is a fact a check can subscribe to rather than something inferred
// from an oscillator starting. It also means a mistyped name throws rather than
// going quietly silent.
//
// The ten are pitched and shaped to be told apart by ear: paper sounds for the
// table's own gestures, a rising chime for a card reaching home, a rasp for a
// refusal, and a long bright sweep for the win.

import { CUES, type CueName } from "./constants";
import type { CascadeState } from "./game";
import type { CueSpec, InitApi } from "@clockwyrks/simple-2d";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.deal]: {
    wave: "triangle",
    freq: 180,
    freqTo: 320,
    gain: 0.18,
    durationMs: 160,
  },
  [CUES.turn]: {
    wave: "square",
    freq: 520,
    freqTo: 380,
    gain: 0.12,
    durationMs: 55,
  },
  [CUES.recycle]: {
    wave: "sawtooth",
    freq: 150,
    freqTo: 420,
    gain: 0.14,
    durationMs: 220,
  },
  [CUES.lift]: {
    wave: "sine",
    freq: 620,
    freqTo: 760,
    gain: 0.1,
    durationMs: 45,
  },
  [CUES.drop]: {
    wave: "sine",
    freq: 420,
    freqTo: 260,
    gain: 0.16,
    durationMs: 70,
  },
  [CUES.reject]: {
    wave: "square",
    freq: 200,
    freqTo: 130,
    gain: 0.13,
    durationMs: 110,
  },
  [CUES.flip]: {
    wave: "triangle",
    freq: 700,
    freqTo: 900,
    gain: 0.12,
    durationMs: 60,
  },
  [CUES.home]: {
    wave: "triangle",
    freq: 660,
    freqTo: 990,
    gain: 0.2,
    durationMs: 150,
  },
  [CUES.launch]: {
    wave: "sine",
    freq: 300,
    freqTo: 820,
    gain: 0.12,
    durationMs: 130,
  },
  [CUES.win]: {
    wave: "triangle",
    freq: 330,
    freqTo: 1320,
    gain: 0.22,
    durationMs: 620,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: Pick<InitApi<CascadeState>, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
