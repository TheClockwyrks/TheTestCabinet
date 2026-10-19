// Carom — audio, as runtime cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// runtime (`src/audio-bus.ts`) owns the audio context, the synthesis, the mute
// state, and the first-gesture unlock. The game's whole part is to DECLARE the
// five cues `src/constants.ts` names, once, and then play them BY NAME as the
// events happen (specs/ui.md).
//
// Playing by name is what keeps the sound legible: a mistyped name throws at the
// moment of the event rather than going quietly silent, which is otherwise
// indistinguishable from a muted bus.
//
// The five are pitched and shaped to be told apart by ear: a bright square click
// off a paddle, a low soft thud off a wall, a woodier falling knock off an
// obstacle, a high buzzing tick where two balls meet, and a longer rising chime
// for a point.

import { CUES, type CueName } from "./constants";
import type { CueSpec } from "./audio-bus";
import type { InitApi } from "./runtime";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.paddleHit]: {
    wave: "square",
    freq: 430,
    freqTo: 620,
    gain: 0.22,
    durationMs: 70,
  },
  [CUES.wallBounce]: {
    wave: "sine",
    freq: 240,
    gain: 0.16,
    durationMs: 50,
  },
  [CUES.obstacleBounce]: {
    wave: "triangle",
    freq: 330,
    freqTo: 180,
    gain: 0.18,
    durationMs: 60,
  },
  // The one sawtooth, and the highest and shortest of the five: it shares neither
  // its waveform nor its register with any other cue, so a ball-to-ball hit in
  // the middle of a rally is never mistaken for a bounce off the field.
  [CUES.ballBounce]: {
    wave: "sawtooth",
    freq: 880,
    freqTo: 740,
    gain: 0.15,
    durationMs: 40,
  },
  [CUES.score]: {
    wave: "triangle",
    freq: 320,
    freqTo: 660,
    gain: 0.2,
    durationMs: 210,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: InitApi): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
