// Fathom — audio, as runtime cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// runtime (`src/audio-bus.ts`) owns the audio context, the synthesis, the mute
// state, and the first-gesture unlock. The game's whole part is to DECLARE the
// seven cues `src/constants.ts` names, once, and then play them BY NAME as the
// events happen (`specs/progression.md`).
//
// Playing by name is what keeps the sound legible: a mistyped name throws at the
// moment of the event rather than going quietly silent, which is otherwise
// indistinguishable from a muted bus.
//
// The seven are pitched and shaped to be told apart by ear in the dark: a bright
// click for a mouthful, a long falling sweep for your own pulse, a low wash for
// ink, a shorter and higher sweep for a hunter's ping, a rising flare, a
// collapsing growl for being caught, and a rising chime for the descent.

import { CUES, type CueName } from "./constants";
import type { CueSpec } from "./audio-bus";
import type { InitApi } from "./runtime";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.eat]: {
    wave: "square",
    freq: 520,
    freqTo: 760,
    gain: 0.14,
    durationMs: 60,
  },
  [CUES.sonar]: {
    wave: "sine",
    freq: 880,
    freqTo: 300,
    gain: 0.18,
    durationMs: 400,
  },
  [CUES.ink]: {
    wave: "sawtooth",
    freq: 200,
    freqTo: 60,
    gain: 0.16,
    durationMs: 350,
  },
  [CUES.predatorPing]: {
    wave: "sine",
    freq: 420,
    freqTo: 180,
    gain: 0.12,
    durationMs: 300,
  },
  [CUES.flare]: {
    wave: "triangle",
    freq: 260,
    freqTo: 620,
    gain: 0.16,
    durationMs: 500,
  },
  [CUES.caught]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 50,
    gain: 0.22,
    durationMs: 600,
  },
  [CUES.descend]: {
    wave: "sine",
    freq: 180,
    freqTo: 520,
    gain: 0.2,
    durationMs: 700,
  },
};

/** Declare every cue, once, before the first tick. */
export function defineCues(api: InitApi): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
