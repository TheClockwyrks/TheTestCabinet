// Carom — audio, as engine cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute state, and the
// first-gesture unlock. The game's whole part is to DECLARE the four cues
// `src/constants.ts` names, once, and then play them BY NAME as the events happen
// (specs/ui.md).
//
// Playing by name is what makes the sound legible from outside: the engine emits a
// `cue:played` event carrying the name, so "the ball hit a paddle and the paddle
// cue played" is a fact a check can subscribe to rather than something inferred
// from an oscillator starting. It also means a mistyped name throws rather than
// silently going quiet.
//
// The four are pitched and shaped to be told apart by ear: a bright square click
// off a paddle, a low soft thud off a wall, a woodier falling knock off an
// obstacle, and a longer rising chime for a point.

import { CUES, type CueName } from "./constants";
import type { CueSpec, InitApi } from "@test-cabinet/simple-2d";

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
  [CUES.score]: {
    wave: "triangle",
    freq: 320,
    freqTo: 660,
    gain: 0.2,
    durationMs: 210,
  },
};

/**
 * Declare every cue, once, before the first frame. Only the `audio` half of the
 * API is taken, so this is independent of the state type the rest of the
 * `InitApi` is generic over.
 */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
