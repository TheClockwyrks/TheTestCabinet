// Carom — audio, as engine cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute state, and the
// first-gesture unlock. The game's whole part is to DEFINE the five cues
// `src/constants.ts` names, once, on the game instance's `initialize` — cue
// definitions belong to the engine, so they survive every level transition —
// and then play them BY NAME through `world.audio` as the events happen
// (specs/ui.md).
//
// Playing by name is what makes the sound legible from outside: the engine
// emits a `cue:played` event carrying the name, so "the ball hit a paddle and
// the paddle cue played" is a fact a check can subscribe to rather than
// something inferred from an oscillator starting. It also means a mistyped name
// throws rather than silently going quiet.
//
// The five are pitched and shaped to be told apart by ear: a bright square
// click off a paddle, a low soft thud off a wall, a woodier falling knock off
// an obstacle, a high buzzing tick where two balls meet, and a longer rising
// chime for a point.

import type { CueSpec, InitApi } from "@test-cabinet/structured-2d";
import { CUES, type CueName } from "./constants";

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
  // The one sawtooth, and the highest and shortest of the five: it shares
  // neither its waveform nor its register with any other cue, so a ball-to-ball
  // hit in the middle of a rally is never mistaken for a bounce off the field.
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

/** Define every cue, once, before the start level opens. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
