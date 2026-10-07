// Spectra — audio, as engine cues (specs/ui.md, specs/mode.md).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the context, the synthesis, the mute state and the first-gesture
// unlock. The game's whole part is to DECLARE the ten cues `src/constants.ts`
// names, once, from the instance's `initialize`, and then play them BY NAME on
// the world's cue bus as the events happen.
//
// A frame collects what it raised into one `FrameCues` and plays from that at the
// end of the tick, which is what upholds the rule that each cue is played on the
// frame its event happens and AT MOST ONCE on that frame: a frame in which a
// discharge destroyed six divers still plays `kill` once. The controller's tick
// and the mode's tick each play their own batch, so a shot sounds on the frame
// the key was read.
//
// WHILE SOUND IS MUTED THE GAME STARTS NO SOUND AT ALL (`specs/ui.md`). A muted
// cue is not played and then silenced: `playCues` reads the bus's own mute bit
// and plays nothing, so nothing reaches the bus while muted.
//
// The ten are pitched and shaped to be told apart by ear: a dry tick for a shot,
// a rising chirp for a flip, a soft swell for an absorb, a bright crack for a
// kill, a long rising sweep for a discharge, a deep falling siren for an
// inversion, a low fall for a lost life, a two-note lift for a cleared stage, a
// small blip as a highlight moves, and a short rising snarl for an overload.

import type { CueSpec, InitApi, WorldAudio } from "@clockwyrks/structured-2d";
import { CUES, type CueName } from "./constants";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 760,
    freqTo: 520,
    gain: 0.08,
    durationMs: 45,
  },
  [CUES.flip]: {
    wave: "triangle",
    freq: 420,
    freqTo: 760,
    gain: 0.12,
    durationMs: 90,
  },
  [CUES.absorb]: {
    wave: "sine",
    freq: 260,
    freqTo: 520,
    gain: 0.14,
    durationMs: 150,
  },
  [CUES.kill]: {
    wave: "sawtooth",
    freq: 620,
    freqTo: 180,
    gain: 0.14,
    durationMs: 110,
  },
  [CUES.discharge]: {
    wave: "sawtooth",
    freq: 140,
    freqTo: 1180,
    gain: 0.22,
    durationMs: 320,
  },
  [CUES.inversion]: {
    wave: "square",
    freq: 900,
    freqTo: 160,
    gain: 0.2,
    durationMs: 420,
  },
  [CUES.hit]: {
    wave: "triangle",
    freq: 330,
    freqTo: 70,
    gain: 0.24,
    durationMs: 480,
  },
  [CUES.stageClear]: {
    wave: "triangle",
    freq: 523,
    freqTo: 1046,
    gain: 0.2,
    durationMs: 340,
  },
  [CUES.menu]: {
    wave: "sine",
    freq: 660,
    freqTo: 800,
    gain: 0.1,
    durationMs: 40,
  },
  [CUES.overload]: {
    wave: "sawtooth",
    freq: 240,
    freqTo: 940,
    gain: 0.18,
    durationMs: 180,
  },
};

/** Declare every cue, once, before the start level opens. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}

/** What one batch of advanced game raised, each flag one cue played once. */
export interface FrameCues {
  fire: boolean;
  flip: boolean;
  absorb: boolean;
  kill: boolean;
  discharge: boolean;
  inversion: boolean;
  hit: boolean;
  stageClear: boolean;
  menu: boolean;
  overload: boolean;
}

/** A batch that has raised nothing yet. */
export function noCues(): FrameCues {
  return {
    fire: false,
    flip: false,
    absorb: false,
    kill: false,
    discharge: false,
    inversion: false,
    hit: false,
    stageClear: false,
    menu: false,
    overload: false,
  };
}

/**
 * Play the cue for each event the batch raised, once per kind — and nothing at
 * all while the bus is muted, so no cue reaches it.
 */
export function playCues(audio: WorldAudio, cues: FrameCues): void {
  if (audio.muted()) return;
  if (cues.fire) audio.play(CUES.fire);
  if (cues.flip) audio.play(CUES.flip);
  if (cues.absorb) audio.play(CUES.absorb);
  if (cues.kill) audio.play(CUES.kill);
  if (cues.overload) audio.play(CUES.overload);
  if (cues.discharge) audio.play(CUES.discharge);
  if (cues.inversion) audio.play(CUES.inversion);
  if (cues.hit) audio.play(CUES.hit);
  if (cues.stageClear) audio.play(CUES.stageClear);
  if (cues.menu) audio.play(CUES.menu);
}
