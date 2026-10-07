// Wireworm — audio, as runtime cues (specs/ui.md).
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// runtime (`src/audio-bus.ts`) owns the audio context, the synthesis, the mute
// state, and the first-gesture unlock. The game's whole part is to DECLARE the
// ten cues `src/constants.ts` names, once, and then play them BY NAME as the
// events happen.
//
// Playing by name is what keeps the sound legible: a mistyped name throws at the
// moment of the event rather than going quietly silent, which is otherwise
// indistinguishable from a muted bus.
//
// The ten are pitched and shaped to be told apart by ear: a short bright chirp
// for a shot, a falling saw for a cut, a long descending roar for the discharge,
// a rising ping as a node arms, a two-note snap for a foe, a low fall for a life
// lost, a rising chime for a level, a bright held note for the win, a long sag
// for the loss, and a tiny click for a menu move.

import { CUES, type CueName } from "./constants";
import type { CueSpec } from "./audio-bus";
import type { InitApi } from "./runtime";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 740,
    freqTo: 1180,
    gain: 0.11,
    durationMs: 65,
  },
  [CUES.cut]: {
    wave: "sawtooth",
    freq: 320,
    freqTo: 140,
    gain: 0.16,
    durationMs: 110,
  },
  [CUES.discharge]: {
    wave: "sawtooth",
    freq: 900,
    freqTo: 90,
    gain: 0.2,
    durationMs: 380,
  },
  [CUES.critical]: {
    wave: "sine",
    freq: 1180,
    freqTo: 1720,
    gain: 0.12,
    durationMs: 130,
  },
  [CUES.foe]: {
    wave: "square",
    freq: 520,
    freqTo: 920,
    gain: 0.14,
    durationMs: 95,
  },
  [CUES.life]: {
    wave: "sawtooth",
    freq: 420,
    freqTo: 60,
    gain: 0.2,
    durationMs: 480,
  },
  [CUES.levelClear]: {
    wave: "triangle",
    freq: 520,
    freqTo: 1040,
    gain: 0.18,
    durationMs: 260,
  },
  [CUES.victory]: {
    wave: "triangle",
    freq: 660,
    freqTo: 1320,
    gain: 0.2,
    durationMs: 620,
  },
  [CUES.gameOver]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 90,
    gain: 0.18,
    durationMs: 760,
  },
  [CUES.menu]: {
    wave: "square",
    freq: 620,
    freqTo: 660,
    gain: 0.08,
    durationMs: 45,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: InitApi): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS))
    api.audio.define(cue, spec);
}
