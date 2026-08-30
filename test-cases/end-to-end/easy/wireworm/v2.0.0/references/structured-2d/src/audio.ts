// Wireworm — audio, as engine cues.
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the context, the synthesis, the mute state and the first-gesture
// unlock. The game's whole part is to DECLARE the ten cues `src/constants.ts`
// names, once, from the instance's `initialize`, and then play them BY NAME on
// the world's cue bus as the events happen (`specs/ui.md`).
//
// A frame collects what it raised into one `FrameCues` and plays from that at
// the end of the tick, which is what upholds the rule that each cue is played on
// the frame its event happens and AT MOST ONCE on that frame: a frame in which a
// discharge fried four segments and cleared nine nodes still plays `discharge`
// once. The controller's tick and the mode's tick each play their own batch, so
// a fired bolt sounds on the frame the key was read.
//
// The ten are pitched and shaped to be told apart by ear: a dry tick for a bolt,
// a short scrape for a cut, a long rising crack for a discharge, a bright ping
// as a node goes critical, a falling thud for a killed foe, a low fall for a
// lost life, a two-note lift for a cleared level, a long fanfare for the win, a
// long fall for the loss, and a small blip as a highlight moves.

import type { CueSpec, InitApi, WorldAudio } from "@test-cabinet/structured-2d";
import { CUES, type CueName } from "./constants";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 720,
    freqTo: 520,
    gain: 0.1,
    durationMs: 45,
  },
  [CUES.cut]: {
    wave: "sawtooth",
    freq: 300,
    freqTo: 170,
    gain: 0.15,
    durationMs: 70,
  },
  [CUES.discharge]: {
    wave: "sawtooth",
    freq: 150,
    freqTo: 920,
    gain: 0.22,
    durationMs: 260,
  },
  [CUES.critical]: {
    wave: "triangle",
    freq: 880,
    freqTo: 1320,
    gain: 0.16,
    durationMs: 120,
  },
  [CUES.foe]: {
    wave: "square",
    freq: 420,
    freqTo: 150,
    gain: 0.18,
    durationMs: 140,
  },
  [CUES.life]: {
    wave: "triangle",
    freq: 330,
    freqTo: 90,
    gain: 0.24,
    durationMs: 420,
  },
  [CUES.levelClear]: {
    wave: "triangle",
    freq: 523,
    freqTo: 1046,
    gain: 0.2,
    durationMs: 320,
  },
  [CUES.victory]: {
    wave: "triangle",
    freq: 392,
    freqTo: 1568,
    gain: 0.24,
    durationMs: 700,
  },
  [CUES.gameOver]: {
    wave: "sawtooth",
    freq: 220,
    freqTo: 70,
    gain: 0.22,
    durationMs: 800,
  },
  [CUES.menu]: {
    wave: "sine",
    freq: 640,
    freqTo: 780,
    gain: 0.1,
    durationMs: 40,
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
  cut: boolean;
  discharge: boolean;
  critical: boolean;
  foe: boolean;
  life: boolean;
  levelClear: boolean;
  victory: boolean;
  gameOver: boolean;
  menu: boolean;
}

/** A batch that has raised nothing yet. */
export function noCues(): FrameCues {
  return {
    fire: false,
    cut: false,
    discharge: false,
    critical: false,
    foe: false,
    life: false,
    levelClear: false,
    victory: false,
    gameOver: false,
    menu: false,
  };
}

/**
 * Play the cue for each event the batch raised, once per kind. A batch that
 * raised more than one plays each of those once; a batch that raised none plays
 * nothing.
 */
export function playCues(audio: WorldAudio, cues: FrameCues): void {
  if (cues.fire) audio.play(CUES.fire);
  if (cues.cut) audio.play(CUES.cut);
  if (cues.critical) audio.play(CUES.critical);
  if (cues.discharge) audio.play(CUES.discharge);
  if (cues.foe) audio.play(CUES.foe);
  if (cues.life) audio.play(CUES.life);
  if (cues.levelClear) audio.play(CUES.levelClear);
  if (cues.victory) audio.play(CUES.victory);
  if (cues.gameOver) audio.play(CUES.gameOver);
  if (cues.menu) audio.play(CUES.menu);
}
