// Carom — audio, as engine cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute state and the
// first-interaction unlock. The game's whole part is to DECLARE four short blips
// once and then play them BY NAME as the events happen (specs/ui.md).
//
// Playing by name is what makes the sound legible from outside: the engine's cue
// log records the name, so "the ball hit a paddle and the paddle cue played" is a
// fact a driver can read, rather than something inferred from an oscillator
// starting. It also means a mistyped name throws instead of silently going quiet.
//
// The four are pitched and shaped to be told apart by ear: a bright square click
// off a paddle, a low soft thud off a wall, a woodier falling knock off an
// obstacle, and a longer rising chime for a point.

import type { CueSpec, Engine } from "@test-cabinet/simple-2d";

/** The cue names, one per event. */
export const CUES = {
  paddleHit: "paddle-hit",
  wallBounce: "wall-bounce",
  obstacleBounce: "obstacle-bounce",
  score: "score",
} as const;

const SPECS: Readonly<Record<string, CueSpec>> = {
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

/** Declare every cue, once, before the first frame. */
export function defineCues(engine: Engine): void {
  for (const [cue, spec] of Object.entries(SPECS)) engine.audio.define(cue, spec);
}
