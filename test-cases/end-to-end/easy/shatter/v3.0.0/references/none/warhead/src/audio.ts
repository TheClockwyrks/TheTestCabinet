// Shatter — the six cues, as the runtime's audio bus takes them.
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// runtime (`src/audio-bus.ts`) owns the context, the synthesis, the mute state
// and the first-gesture unlock. The game's whole part is to DECLARE the six cues
// `specs/audio.md` names, once, and then play them BY NAME as their events happen
// (`src/game.ts`).
//
// Playing by name is what keeps the sound legible: a mistyped name throws at the
// moment of the event rather than going quietly silent, which is otherwise
// indistinguishable from a muted bus.
//
// The six are pitched and shaped to be told apart by ear: a short bright click
// for the gun, a falling crunch for a rock coming apart, a low held rumble under
// thrust, a wobbling descent for the saucer's arrival, a long dive for the ship
// being lost, and a rising chime for an extra ship. `thrust` is the one held
// cue — `specs/audio.md` says it sounds for as long as thrust is applied, and
// that a single blip at the start of a burn is not this cue.

import { CUES, type CueName } from "./constants";
import type { CueSpec } from "./audio-bus";
import type { InitApi } from "./runtime";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 720,
    freqTo: 380,
    gain: 0.16,
    durationMs: 70,
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
    freq: 110,
    gain: 0.1,
    durationMs: 0,
    held: true,
  },
  [CUES.saucer]: {
    wave: "triangle",
    freq: 620,
    freqTo: 220,
    gain: 0.18,
    durationMs: 420,
  },
  [CUES.death]: {
    wave: "sawtooth",
    freq: 320,
    freqTo: 40,
    gain: 0.24,
    durationMs: 620,
  },
  [CUES.extraLife]: {
    wave: "triangle",
    freq: 440,
    freqTo: 1180,
    gain: 0.2,
    durationMs: 340,
  },
};

/** Declare every cue, once, before the first tick. */
export function defineCues(api: InitApi): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
