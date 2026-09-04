// Spectra — the nine audio cues, and how a frame raises one.
//
// `specs/ui.md` fixes the nine names and the event behind each, and says each is
// played on the frame its event happens AND AT MOST ONCE ON THAT FRAME. So the
// game does not play a cue where the event happens: it RAISES the cue into a set
// the frame carries, and the frame plays each raised cue once as it closes. A
// discharge that pops nine drones in one sub-step therefore plays one `kill`.
//
// The synthesis is this build's own. Each is a short, distinct shape so the
// events are told apart by ear: a rising blip for a shot, a two-tone sweep for a
// flip, a soft swell for an absorb, a snap for a kill, a long fall for the
// discharge, a deep swept tone for the inversion, a harsh drop for a hit, a rise
// for a stage clear, and a click for a menu move.

import type { CueSpec } from "./audio-bus";
import { CUES, type CueName } from "./constants";
import type { SpectraState } from "./types";

/** Raise a cue for the frame in progress. Raising one twice plays it once. */
export function raise(state: SpectraState, cue: CueName): void {
  state.cues.add(cue);
}

/** The nine cues' synthesis, by name. */
export const CUE_SPECS: Record<CueName, CueSpec> = {
  fire: { wave: "square", freq: 720, freqTo: 1180, gain: 0.1, durationMs: 60 },
  flip: {
    wave: "triangle",
    freq: 320,
    freqTo: 880,
    gain: 0.15,
    durationMs: 130,
  },
  absorb: { wave: "sine", freq: 240, freqTo: 620, gain: 0.16, durationMs: 190 },
  kill: {
    wave: "sawtooth",
    freq: 540,
    freqTo: 120,
    gain: 0.13,
    durationMs: 130,
  },
  discharge: {
    wave: "sawtooth",
    freq: 1400,
    freqTo: 90,
    gain: 0.2,
    durationMs: 520,
  },
  inversion: {
    wave: "sine",
    freq: 120,
    freqTo: 700,
    gain: 0.22,
    durationMs: 620,
  },
  hit: { wave: "square", freq: 300, freqTo: 60, gain: 0.22, durationMs: 380 },
  "stage-clear": {
    wave: "triangle",
    freq: 420,
    freqTo: 1500,
    gain: 0.2,
    durationMs: 620,
  },
  menu: { wave: "square", freq: 900, gain: 0.08, durationMs: 40 },
};

/** Every cue name, in the order the specification lists them. */
export const CUE_NAMES: readonly CueName[] = CUES;
