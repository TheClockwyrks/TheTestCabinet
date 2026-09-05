// Shatter — audio, as engine cues (`specs/audio.md`).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute bit and the
// first-gesture unlock. The game's whole part is to DECLARE the six cues
// `src/constants.ts` names, once, and then play them BY NAME as their events
// happen.
//
// Playing by name is what makes the sound legible from outside: the engine emits
// a `cue:played` event carrying the name, so "a rock came apart and the shatter
// cue played" is a fact that can be subscribed to rather than inferred from an
// oscillator starting, and a mistyped name throws instead of going quiet.
//
// The six are pitched and shaped to be told apart by ear: a short bright chirp
// for the gun, a dry crunch for a rock breaking, a low held rumble for thrust, a
// warbling rise for the saucer arriving, a long fall for the ship being lost,
// and a bright rising chime for an extra ship. `thrust` is the one that is
// LOOPED rather than struck, so its `durationMs` is unused and only its wave,
// frequency and gain are heard.

import { CUES, type CueName } from "./constants";
import type { CueSpec, InitApi } from "@clockwyrks/simple-2d";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 900,
    freqTo: 1500,
    gain: 0.1,
    durationMs: 45,
  },
  [CUES.shatter]: {
    wave: "sawtooth",
    freq: 260,
    freqTo: 70,
    gain: 0.22,
    durationMs: 220,
  },
  [CUES.thrust]: {
    wave: "sawtooth",
    freq: 96,
    gain: 0.12,
    durationMs: 200,
  },
  [CUES.saucer]: {
    wave: "triangle",
    freq: 320,
    freqTo: 760,
    gain: 0.18,
    durationMs: 420,
  },
  [CUES.death]: {
    wave: "sine",
    freq: 340,
    freqTo: 50,
    gain: 0.26,
    durationMs: 750,
  },
  [CUES.extraLife]: {
    wave: "triangle",
    freq: 520,
    freqTo: 1560,
    gain: 0.22,
    durationMs: 520,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
