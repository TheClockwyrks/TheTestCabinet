// Wireworm — audio, as engine cues (`specs/ui.md`).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute bit and the
// first-gesture unlock. The game's whole part is to DECLARE the ten cues
// `src/constants.ts` names, once, and then play them BY NAME as their events
// happen.
//
// Playing by name is what makes the sound legible from outside: the engine emits
// a `cue:played` event carrying the name, so "a bolt cut a segment and the cut
// cue played" is a fact that can be subscribed to rather than inferred from an
// oscillator starting, and a mistyped name throws instead of going quiet.
//
// The ten are pitched and shaped to be told apart by ear: a short bright chirp
// for the gun, a dry snap for a cut, a long falling roar for a discharge, a
// rising warning for a node going critical, a hollow pop for a foe, a long fall
// for a lost life, a rising three-note lift for a level, a bright long chime for
// victory, a deep collapse for the end of a run, and a small tick for a menu.

import { CUES, type CueName } from "./constants";
import type { CueSpec, InitApi } from "@test-cabinet/simple-2d";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 880,
    freqTo: 1320,
    gain: 0.12,
    durationMs: 45,
  },
  [CUES.cut]: {
    wave: "square",
    freq: 320,
    freqTo: 120,
    gain: 0.18,
    durationMs: 70,
  },
  [CUES.discharge]: {
    wave: "sawtooth",
    freq: 420,
    freqTo: 60,
    gain: 0.26,
    durationMs: 380,
  },
  [CUES.critical]: {
    wave: "triangle",
    freq: 520,
    freqTo: 1040,
    gain: 0.16,
    durationMs: 130,
  },
  [CUES.foe]: {
    wave: "triangle",
    freq: 240,
    freqTo: 640,
    gain: 0.2,
    durationMs: 150,
  },
  [CUES.life]: {
    wave: "sine",
    freq: 300,
    freqTo: 70,
    gain: 0.26,
    durationMs: 520,
  },
  [CUES.levelClear]: {
    wave: "triangle",
    freq: 440,
    freqTo: 990,
    gain: 0.22,
    durationMs: 420,
  },
  [CUES.victory]: {
    wave: "sine",
    freq: 520,
    freqTo: 1560,
    gain: 0.24,
    durationMs: 900,
  },
  [CUES.gameOver]: {
    wave: "sawtooth",
    freq: 220,
    freqTo: 40,
    gain: 0.24,
    durationMs: 900,
  },
  [CUES.menu]: {
    wave: "square",
    freq: 660,
    gain: 0.1,
    durationMs: 35,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
