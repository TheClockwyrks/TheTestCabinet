// Meltdown — the ten cues, as synthesis (specs/audio.md).
//
// One entry per event, each short and distinct from the other nine: the reactor
// answers in tones rather than samples, and the build ships no audio file. The
// names are the specification's; the waveforms and envelopes are this build's.

import { CUES } from "./constants";
import type { CueSpec } from "./audio-bus";

/** Every cue this game declares, by the name `specs/audio.md` gives it. */
export const CUE_SPECS: ReadonlyArray<readonly [string, CueSpec]> = [
  // A shot: a short, bright tick, quiet enough to sit under a busy wave.
  [
    CUES.fire,
    { wave: "square", freq: 880, freqTo: 620, durationMs: 45, gain: 0.06 },
  ],
  // A trip: the alarm, falling away.
  [
    CUES.trip,
    { wave: "sawtooth", freq: 260, freqTo: 70, durationMs: 420, gain: 0.22 },
  ],
  // A kill: a dry knock.
  [
    CUES.death,
    { wave: "triangle", freq: 320, freqTo: 150, durationMs: 90, gain: 0.12 },
  ],
  // A leak: a low, ugly swell.
  [
    CUES.leak,
    { wave: "sawtooth", freq: 150, freqTo: 90, durationMs: 300, gain: 0.24 },
  ],
  // A tower landing on the floor.
  [
    CUES.place,
    { wave: "square", freq: 420, freqTo: 720, durationMs: 90, gain: 0.16 },
  ],
  // A tower leaving it.
  [
    CUES.sell,
    { wave: "square", freq: 620, freqTo: 300, durationMs: 110, gain: 0.16 },
  ],
  // A wave cleared: a rising two-tone.
  [
    CUES.waveClear,
    { wave: "triangle", freq: 520, freqTo: 990, durationMs: 260, gain: 0.2 },
  ],
  // The run won.
  [
    CUES.victory,
    { wave: "triangle", freq: 440, freqTo: 1320, durationMs: 700, gain: 0.24 },
  ],
  // The run lost.
  [
    CUES.gameOver,
    { wave: "sawtooth", freq: 320, freqTo: 60, durationMs: 900, gain: 0.24 },
  ],
  // A menu highlight moving.
  [CUES.menu, { wave: "square", freq: 700, durationMs: 40, gain: 0.1 }],
];
