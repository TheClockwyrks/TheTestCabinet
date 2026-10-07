// Refract — audio, as engine cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// engine owns the context, the synthesis, the mute state, and the
// first-gesture unlock. The game's whole part is to DECLARE the five cues
// `src/constants.ts` names, once, from the instance's `initialize`, and then
// play them BY NAME on the world's cue bus as the events happen (specs/ui.md)
// — each on the frame its event happens, and at most once on that frame, which
// `playEvents` upholds by playing from a batch's merged event flags: the
// player controller merges every pointer sample its tick resolved into one
// batch, and each debug operation is a batch of its own.
//
// The five are pitched and shaped to be told apart by ear: a bright rising
// tick as a segment connects, a soft falling tick as one is retracted, a
// two-note chime when a channel closes, a longer rising sweep for the solve,
// and a low sweep down when the board is wiped.

import type { CueSpec, InitApi, WorldAudio } from "@clockwyrks/structured-2d";
import { CUES, type CueName } from "./constants";

export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.connect]: {
    wave: "sine",
    freq: 520,
    freqTo: 680,
    gain: 0.16,
    durationMs: 60,
  },
  [CUES.retract]: {
    wave: "sine",
    freq: 420,
    freqTo: 300,
    gain: 0.14,
    durationMs: 55,
  },
  [CUES.channelComplete]: {
    wave: "triangle",
    freq: 523,
    freqTo: 784,
    gain: 0.2,
    durationMs: 150,
  },
  [CUES.solved]: {
    wave: "triangle",
    freq: 392,
    freqTo: 1046,
    gain: 0.22,
    durationMs: 340,
  },
  [CUES.clear]: {
    wave: "sawtooth",
    freq: 220,
    freqTo: 110,
    gain: 0.1,
    durationMs: 120,
  },
};

/** Declare every cue, once, before the start level opens. */
export function defineCues(api: Pick<InitApi, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}

/** What one batch of resolved input raised, each flag one cue played once. */
export interface FrameEvents {
  connect: boolean;
  retract: boolean;
  channelComplete: boolean;
  solved: boolean;
  clear: boolean;
}

/**
 * Play the cue for each event the batch raised. A batch that raises more than
 * one plays each of those once; a batch that raises none plays nothing.
 */
export function playEvents(audio: WorldAudio, events: FrameEvents): void {
  if (events.connect) audio.play(CUES.connect);
  if (events.retract) audio.play(CUES.retract);
  if (events.channelComplete) audio.play(CUES.channelComplete);
  if (events.solved) audio.play(CUES.solved);
  if (events.clear) audio.play(CUES.clear);
}
