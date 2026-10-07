// Cascade — the ten cues, and when a frame plays what it raised.
//
// specs/audio.md fixes the ten names and the event each answers, and leaves the
// sound itself to the build. Each of these is one oscillator through one gain
// envelope (`src/audio-bus.ts`), chosen so the ten are told apart by ear: the
// table sounds are short and woody, the foundation and the win are bright and
// rising, and a refusal is a low buzz.
//
// A cue is RAISED where its event happens and PLAYED at the end of the frame. A
// frame plays each cue it raised once, in a fixed order (specs/audio.md), which is
// why the raised set is a `Set` and not a list: a frame that turns three cards
// still sounds one `turn`.

import { CUE_ORDER, CUES, type CueName } from "./constants";
import type { CueSpec } from "./audio-bus";
import type { CascadeState } from "./state";

/** The synthesis behind each of the ten cues. This build's own choices. */
export const CUE_SPECS: Record<CueName, CueSpec> = {
  [CUES.deal]: { wave: "triangle", freq: 300, freqTo: 190, durationMs: 130 },
  [CUES.turn]: { wave: "triangle", freq: 520, freqTo: 400, durationMs: 70 },
  [CUES.recycle]: { wave: "sine", freq: 220, freqTo: 460, durationMs: 190 },
  [CUES.lift]: { wave: "sine", freq: 640, freqTo: 720, durationMs: 55 },
  [CUES.drop]: { wave: "triangle", freq: 420, freqTo: 300, durationMs: 80 },
  [CUES.reject]: {
    wave: "square",
    freq: 150,
    freqTo: 96,
    gain: 0.1,
    durationMs: 130,
  },
  [CUES.flip]: { wave: "sine", freq: 880, freqTo: 660, durationMs: 60 },
  [CUES.home]: { wave: "sine", freq: 700, freqTo: 1050, durationMs: 130 },
  [CUES.launch]: {
    wave: "sine",
    freq: 460,
    freqTo: 900,
    gain: 0.12,
    durationMs: 90,
  },
  [CUES.win]: { wave: "triangle", freq: 520, freqTo: 1300, durationMs: 420 },
};

/** What a cue is played through. The runtime's audio bus satisfies it. */
export interface CueSink {
  play(cue: string): void;
}

/** Declare all ten cues on the bus, once, while the game initializes. */
export function defineCues(define: (cue: string, spec: CueSpec) => void): void {
  for (const name of CUE_ORDER) define(name, CUE_SPECS[name]);
}

/** Raise a cue for this frame. Raising the same one twice still sounds once. */
export function raiseCue(state: CascadeState, cue: CueName): void {
  state.pendingCues.add(cue);
}

/** Play everything this frame raised, once each, in the fixed order. */
export function flushCues(state: CascadeState, sink: CueSink): void {
  if (state.pendingCues.size === 0) return;
  for (const name of CUE_ORDER) {
    if (state.pendingCues.has(name)) sink.play(name);
  }
  state.pendingCues.clear();
}
