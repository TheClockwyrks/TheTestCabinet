// Fathom — audio, as engine cues.
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the context, the synthesis, the mute bit and the first-gesture
// unlock. The game's whole part is to DECLARE the seven cues `src/constants.ts`
// names, once, from the instance's `initialize`, and to play them by name on the
// world's cue bus as the events happen (`specs/progression.md`).
//
// A cue is played at most once on the tick its event happens, so a tick collects
// the cues it raised into a bag and plays that bag out at the end: two creatures
// that raise the same cue on one tick sound it once, and a tick that raises
// several sounds each of them once.
//
// The seven are pitched and shaped to be told apart by ear: a short bright tick
// for a mouthful, a rising cyan sweep for the pulse, a soft low wash for the
// ink, a falling violet chirp for a hunter's ping, a bright flare burst, a harsh
// low hit for a catch, and a long descending tone for a maze cleared.

import type { CueSpec, InitApi, WorldAudio } from "@clockwyrks/structured-2d";
import { CUES, type CueName } from "./constants";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.eat]: {
    wave: "sine",
    freq: 660,
    freqTo: 880,
    gain: 0.12,
    durationMs: 55,
  },
  [CUES.sonar]: {
    wave: "sine",
    freq: 320,
    freqTo: 1180,
    gain: 0.18,
    durationMs: 260,
  },
  [CUES.ink]: {
    wave: "triangle",
    freq: 180,
    freqTo: 70,
    gain: 0.2,
    durationMs: 320,
  },
  [CUES.predatorPing]: {
    wave: "square",
    freq: 900,
    freqTo: 480,
    gain: 0.1,
    durationMs: 180,
  },
  [CUES.flare]: {
    wave: "sawtooth",
    freq: 240,
    freqTo: 1320,
    gain: 0.16,
    durationMs: 220,
  },
  [CUES.caught]: {
    wave: "sawtooth",
    freq: 200,
    freqTo: 55,
    gain: 0.26,
    durationMs: 520,
  },
  [CUES.descend]: {
    wave: "triangle",
    freq: 740,
    freqTo: 160,
    gain: 0.22,
    durationMs: 620,
  },
};

/** Declare every cue, once, before the start level opens. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}

/** The cues one tick raised. A set, so a repeat within the tick is one play. */
export type CueBag = Set<CueName>;

export function noCues(): CueBag {
  return new Set<CueName>();
}

/**
 * Play each cue the bag holds, in the fixed order `CUES` declares them in, so
 * a tick that raised several always sounds them the same way round.
 */
export function playCues(audio: WorldAudio, bag: CueBag): void {
  for (const cue of Object.values(CUES)) {
    if (bag.has(cue)) audio.play(cue);
  }
}
