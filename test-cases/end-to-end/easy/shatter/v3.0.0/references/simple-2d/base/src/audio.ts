// Shatter — audio, as engine cues (`specs/audio.md`).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute bit and the
// first-gesture unlock. The game's whole part is to DECLARE the six cues
// `src/constants.ts` names, once, and then play them BY NAME as their events
// happen.
//
// Playing by name is what makes the sound legible from outside: the engine
// emits a `cue:played` event carrying the name, so "a rock came apart and the
// shatter cue played" is a fact that can be subscribed to rather than inferred
// from an oscillator starting, and a mistyped name throws instead of going
// quiet.
//
// `thrust` is the one held cue. It is LOOPED rather than played, so it sounds
// for as long as the burn lasts and stops when it ends; `src/game.ts` starts
// and stops the loop from the ship's own `thrusting`.
//
// The six are pitched and shaped to be told apart by ear: a short bright chirp
// for the gun, a dry crunch for a rock coming apart, a low steady rumble under
// the burn, a warbling descent for a saucer arriving, a long fall for a lost
// ship, and a rising chime for an extra one.

import { CUES, type CueName } from "./constants";
import type { CueSpec, InitApi } from "@test-cabinet/simple-2d";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 920,
    freqTo: 1380,
    gain: 0.11,
    durationMs: 45,
  },
  [CUES.shatter]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 90,
    gain: 0.2,
    durationMs: 180,
  },
  [CUES.thrust]: {
    wave: "sawtooth",
    freq: 110,
    gain: 0.09,
    durationMs: 200,
  },
  [CUES.saucer]: {
    wave: "triangle",
    freq: 700,
    freqTo: 260,
    gain: 0.18,
    durationMs: 480,
  },
  [CUES.death]: {
    wave: "sine",
    freq: 320,
    freqTo: 50,
    gain: 0.26,
    durationMs: 700,
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
