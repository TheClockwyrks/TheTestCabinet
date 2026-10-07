// Cascade — the ten cues, declared once and played by name.
//
// `specs/audio.md` fixes the names and the events; the synthesis is this
// build's. The bus (`src/audio-bus.ts`) owns the audio context, the mute bit
// and the first-gesture unlock, so all that is here is the shape of each of the
// ten sounds and the one call that declares them.
//
// They are pitched and shaped to be told apart by ear: soft wooden knocks for
// the cards moving, a bright rising chime when a card goes home, a short buzz
// when a drop is refused, a riffle for the deal and the recycle, and a long
// rising fanfare for the win.

import type { CueSpec } from "./audio-bus";
import { CUES, type CueName } from "./constants";
import type { InitApi } from "./runtime";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.deal]: {
    wave: "triangle",
    freq: 180,
    freqTo: 320,
    gain: 0.18,
    durationMs: 220,
  },
  [CUES.turn]: {
    wave: "triangle",
    freq: 420,
    freqTo: 300,
    gain: 0.16,
    durationMs: 70,
  },
  [CUES.recycle]: {
    wave: "sawtooth",
    freq: 150,
    freqTo: 90,
    gain: 0.14,
    durationMs: 260,
  },
  [CUES.lift]: {
    wave: "sine",
    freq: 520,
    freqTo: 640,
    gain: 0.13,
    durationMs: 55,
  },
  [CUES.drop]: {
    wave: "sine",
    freq: 300,
    freqTo: 200,
    gain: 0.18,
    durationMs: 85,
  },
  [CUES.reject]: {
    wave: "square",
    freq: 150,
    freqTo: 100,
    gain: 0.12,
    durationMs: 120,
  },
  [CUES.flip]: {
    wave: "triangle",
    freq: 660,
    freqTo: 880,
    gain: 0.12,
    durationMs: 60,
  },
  [CUES.home]: {
    wave: "sine",
    freq: 520,
    freqTo: 1040,
    gain: 0.2,
    durationMs: 150,
  },
  [CUES.launch]: {
    wave: "square",
    freq: 240,
    freqTo: 700,
    gain: 0.1,
    durationMs: 90,
  },
  [CUES.win]: {
    wave: "triangle",
    freq: 330,
    freqTo: 1320,
    gain: 0.24,
    durationMs: 700,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: InitApi): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
