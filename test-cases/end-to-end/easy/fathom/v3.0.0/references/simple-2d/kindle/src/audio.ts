// Fathom — audio, as engine cues (`specs/progression.md`).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute bit and the
// first-gesture unlock. The game's whole part is to DECLARE the seven cues
// `src/constants.ts` names, once, and then to play them BY NAME as their events
// happen.
//
// Playing by name is what makes the sound legible from outside: the engine emits
// a `cue:played` event carrying the name, so "the bloom began and the flare cue
// played" is a fact a listener can subscribe to. It also means a mistyped name
// throws rather than disappearing into the same silence a muted bus produces.
//
// The seven are pitched and shaped to be told apart by ear: a bright chirp for a
// grazed plankton, a long falling sweep for the forager's own pulse, a low
// smothered rasp for ink, a softer and higher sweep for a hunter's ping, a warm
// rising burst for a bloom, a plunging saw for being caught, and a long rising
// tone for the descent.

import { CUES, type CueName } from "./constants";
import type { CueSpec, InitApi } from "@clockwyrks/simple-2d";

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
    freq: 900,
    freqTo: 300,
    gain: 0.18,
    durationMs: 400,
  },
  [CUES.ink]: {
    wave: "sawtooth",
    freq: 200,
    freqTo: 60,
    gain: 0.16,
    durationMs: 340,
  },
  [CUES.predatorPing]: {
    wave: "triangle",
    freq: 440,
    freqTo: 190,
    gain: 0.12,
    durationMs: 340,
  },
  [CUES.flare]: {
    wave: "triangle",
    freq: 260,
    freqTo: 640,
    gain: 0.18,
    durationMs: 480,
  },
  [CUES.caught]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 50,
    gain: 0.22,
    durationMs: 560,
  },
  [CUES.descend]: {
    wave: "sine",
    freq: 180,
    freqTo: 540,
    gain: 0.2,
    durationMs: 700,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: Pick<InitApi<never>, "audio">): void {
  for (const cue of Object.keys(CUE_SPECS) as CueName[]) {
    api.audio.define(cue, CUE_SPECS[cue]);
  }
}
