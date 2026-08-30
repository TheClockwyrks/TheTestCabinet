// Spectra — audio, as engine cues (`specs/ui.md`, `specs/mode.md`).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the audio context, the synthesis, the mute bit and the
// first-gesture unlock. The game's whole part is to DECLARE the ten cues
// `src/constants.ts` names, once, and then play them BY NAME as their events
// happen.
//
// Playing by name is what makes the sound legible from outside: the engine emits a
// `cue:played` event carrying the name, so "a matching shot destroyed a drone and
// the kill cue played" is a fact that can be subscribed to rather than inferred
// from an oscillator starting, and a mistyped name throws instead of going quiet.
//
// The ten are pitched and shaped to be told apart by ear: a dry chirp for the
// cannon, a two-tone slide for the flip, a soft swell for an absorbed bullet, a
// bright snap for a kill, a long falling roar for the discharge, a rising sweep
// for the inversion, a deep fall for a lost life, a rising lift for a cleared
// stage, a small tick for a menu, and a hard buzzing crack for an overload.

import { CUES, type CueName } from "./constants";
import type { CueSpec, InitApi } from "@test-cabinet/simple-2d";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 940,
    freqTo: 1380,
    gain: 0.1,
    durationMs: 40,
  },
  [CUES.flip]: {
    wave: "triangle",
    freq: 520,
    freqTo: 880,
    gain: 0.16,
    durationMs: 90,
  },
  [CUES.absorb]: {
    wave: "sine",
    freq: 220,
    freqTo: 520,
    gain: 0.18,
    durationMs: 160,
  },
  [CUES.kill]: {
    wave: "square",
    freq: 360,
    freqTo: 130,
    gain: 0.18,
    durationMs: 70,
  },
  [CUES.discharge]: {
    wave: "sawtooth",
    freq: 480,
    freqTo: 55,
    gain: 0.26,
    durationMs: 420,
  },
  [CUES.inversion]: {
    wave: "sine",
    freq: 180,
    freqTo: 1260,
    gain: 0.24,
    durationMs: 520,
  },
  [CUES.hit]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 45,
    gain: 0.26,
    durationMs: 620,
  },
  [CUES.stageClear]: {
    wave: "triangle",
    freq: 460,
    freqTo: 1180,
    gain: 0.22,
    durationMs: 460,
  },
  [CUES.menu]: {
    wave: "square",
    freq: 680,
    gain: 0.09,
    durationMs: 32,
  },
  [CUES.overload]: {
    wave: "sawtooth",
    freq: 130,
    freqTo: 700,
    gain: 0.2,
    durationMs: 200,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}
