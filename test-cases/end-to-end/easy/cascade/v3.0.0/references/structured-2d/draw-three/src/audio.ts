// Cascade — audio, as engine cues (`specs/audio.md`).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// engine owns the context, the synthesis, the mute state and the first-gesture
// unlock. The game's whole part is to DECLARE the ten cues `src/constants.ts`
// names, once, from the instance's `initialize`, and then to play them BY NAME on
// the world's cue bus as their events happen.
//
// A batch of work collects what it raised into one `FrameEvents` and plays from
// that when the batch ends, which is what upholds the rule that each cue sounds
// on the frame its event happens and AT MOST ONCE on that frame: a stock turn
// that moved three cards plays `turn` once. The controller's tick, the mode's
// tick and each debug operation each play their own batch, so a card sent home
// from code sounds exactly as one sent home by hand.
//
// `toggleMute` rides in the same batch because muting is the runtime's, not the
// state's: the HUD's `SOUND` control is resolved by the same pure pointer path as
// every other press, and the flag is how that path asks the bus to flip its bit
// without reaching for it.
//
// The ten are pitched and shaped to be told apart by ear: a low riffle for a
// deal, a dry click for a turn, a rising sweep for a recycle, a small lift for a
// card picked up, a soft knock for a card put down, a flat buzz for a refusal, a
// light tick for a card turning face-up, a bright rise for a card reaching home,
// a falling pop for a launch, and a long fanfare for the win.

import type { CueSpec, InitApi, WorldAudio } from "@test-cabinet/structured-2d";
import { CUES, type CueName } from "./constants";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.deal]: {
    wave: "sawtooth",
    freq: 180,
    freqTo: 90,
    gain: 0.16,
    durationMs: 220,
  },
  [CUES.turn]: {
    wave: "square",
    freq: 520,
    freqTo: 380,
    gain: 0.1,
    durationMs: 60,
  },
  [CUES.recycle]: {
    wave: "triangle",
    freq: 200,
    freqTo: 420,
    gain: 0.18,
    durationMs: 220,
  },
  [CUES.lift]: {
    wave: "sine",
    freq: 660,
    freqTo: 760,
    gain: 0.08,
    durationMs: 40,
  },
  [CUES.drop]: {
    wave: "square",
    freq: 380,
    freqTo: 260,
    gain: 0.12,
    durationMs: 70,
  },
  [CUES.reject]: {
    wave: "sawtooth",
    freq: 220,
    freqTo: 120,
    gain: 0.14,
    durationMs: 120,
  },
  [CUES.flip]: {
    wave: "triangle",
    freq: 720,
    freqTo: 900,
    gain: 0.1,
    durationMs: 50,
  },
  [CUES.home]: {
    wave: "triangle",
    freq: 660,
    freqTo: 1320,
    gain: 0.16,
    durationMs: 140,
  },
  [CUES.launch]: {
    wave: "square",
    freq: 900,
    freqTo: 300,
    gain: 0.12,
    durationMs: 70,
  },
  [CUES.win]: {
    wave: "triangle",
    freq: 392,
    freqTo: 1568,
    gain: 0.24,
    durationMs: 700,
  },
};

/** Declare every cue, once, before the start level opens. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}

/** What one batch of work raised: each cue flag plays once, and mute flips once. */
export interface FrameEvents extends Record<CueName, boolean> {
  /** The HUD's `SOUND` control asking the runtime to flip its mute bit. */
  toggleMute: boolean;
}

/** A batch that has raised nothing yet. */
export function noEvents(): FrameEvents {
  return {
    deal: false,
    turn: false,
    recycle: false,
    lift: false,
    drop: false,
    reject: false,
    flip: false,
    home: false,
    launch: false,
    win: false,
    toggleMute: false,
  };
}

/**
 * Flip the mute bit if the batch asked, then play the cue for each event it
 * raised, once per kind. A batch that raised more than one plays each of those
 * once; a batch that raised none plays nothing.
 */
export function applyEvents(audio: WorldAudio, events: FrameEvents): void {
  if (events.toggleMute) audio.setMuted(!audio.muted());
  for (const cue of Object.keys(CUES) as CueName[]) {
    if (events[cue]) audio.play(CUES[cue]);
  }
}
