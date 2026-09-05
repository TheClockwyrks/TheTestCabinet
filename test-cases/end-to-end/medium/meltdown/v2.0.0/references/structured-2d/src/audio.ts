// Meltdown — audio, as engine cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the synthesis, the mute state, and the first-gesture
// unlock. Meltdown's whole part is to DECLARE the ten cues `src/constants.ts`
// names, once, from the instance's `initialize`, and to play them by name on
// the world's bus as their events resolve (specs/audio.md).
//
// A cue is raised by the frame that RESOLVES the event it answers, so every
// cue names one real frame. A frame's raised cues are gathered as flags and
// played once each at the end of the tick that raised them, which is why a
// hundred shots landing in one frame sound one `fire` rather than a hundred.
// No operation of the debug surface plays a cue: a pose resolves outside the
// frame loop, so it names no frame for a cue to belong to.

import { CUES, type CueName } from "./constants";
import type { CueSpec, InitApi, WorldAudio } from "@clockwyrks/structured-2d";

/**
 * The ten cues, pitched and shaped to be told apart by ear: a dry tick as a
 * shot lands, a long fall as a gun trips, a bright rise as a wave clears, and
 * a low collapse when the run is lost.
 */
export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 330,
    freqTo: 250,
    gain: 0.07,
    durationMs: 40,
  },
  [CUES.trip]: {
    wave: "sawtooth",
    freq: 190,
    freqTo: 70,
    gain: 0.22,
    durationMs: 320,
  },
  [CUES.death]: {
    wave: "triangle",
    freq: 300,
    freqTo: 150,
    gain: 0.13,
    durationMs: 90,
  },
  [CUES.leak]: {
    wave: "sine",
    freq: 230,
    freqTo: 110,
    gain: 0.2,
    durationMs: 260,
  },
  [CUES.place]: {
    wave: "square",
    freq: 480,
    freqTo: 640,
    gain: 0.15,
    durationMs: 70,
  },
  [CUES.sell]: {
    wave: "sine",
    freq: 620,
    freqTo: 360,
    gain: 0.14,
    durationMs: 90,
  },
  [CUES.waveClear]: {
    wave: "triangle",
    freq: 440,
    freqTo: 880,
    gain: 0.2,
    durationMs: 220,
  },
  [CUES.victory]: {
    wave: "triangle",
    freq: 392,
    freqTo: 1175,
    gain: 0.24,
    durationMs: 600,
  },
  [CUES.gameOver]: {
    wave: "sawtooth",
    freq: 200,
    freqTo: 60,
    gain: 0.22,
    durationMs: 700,
  },
  [CUES.menu]: {
    wave: "square",
    freq: 700,
    gain: 0.09,
    durationMs: 30,
  },
};

/** Declare every cue, once, before the start level opens. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const cue of Object.values(CUES)) {
    api.audio.define(cue, CUE_SPECS[cue]);
  }
}

/** Which of the ten a frame raised, each at most once. */
export interface CueFlags {
  fire: boolean;
  trip: boolean;
  death: boolean;
  leak: boolean;
  place: boolean;
  sell: boolean;
  waveClear: boolean;
  victory: boolean;
  gameOver: boolean;
  menu: boolean;
}

/** A frame that has raised nothing yet. */
export function noCues(): CueFlags {
  return {
    fire: false,
    trip: false,
    death: false,
    leak: false,
    place: false,
    sell: false,
    waveClear: false,
    victory: false,
    gameOver: false,
    menu: false,
  };
}

/** Fold one set of raised cues into another. */
export function mergeCues(into: CueFlags, from: CueFlags): CueFlags {
  for (const key of Object.keys(into) as (keyof CueFlags)[]) {
    if (from[key]) into[key] = true;
  }
  return into;
}

/** Play each cue the frame raised, once. */
export function playCues(audio: WorldAudio, flags: CueFlags): void {
  if (flags.fire) audio.play(CUES.fire);
  if (flags.trip) audio.play(CUES.trip);
  if (flags.death) audio.play(CUES.death);
  if (flags.leak) audio.play(CUES.leak);
  if (flags.place) audio.play(CUES.place);
  if (flags.sell) audio.play(CUES.sell);
  if (flags.waveClear) audio.play(CUES.waveClear);
  if (flags.victory) audio.play(CUES.victory);
  if (flags.gameOver) audio.play(CUES.gameOver);
  if (flags.menu) audio.play(CUES.menu);
}
