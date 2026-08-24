// Refract — audio, as the runtime's cues.
//
// There is no Web Audio graph here, no mute flag, and no autoplay unlock: the
// runtime's audio bus owns the context, the synthesis, the mute state, and the
// first-gesture unlock (src/audio-bus.ts). The game's whole part is to DECLARE
// the five cues `src/constants.ts` names, once, and then play them BY NAME as
// the events happen (specs/ui.md) — each on the frame its event happens, and
// at most once on that frame, which `playFrameEvents` enforces by playing from
// the frame's merged event flags rather than per pointer sample.
//
// The five are pitched and shaped to be told apart by ear: a bright rising
// tick as a segment connects, a soft falling tick as one is retracted, a
// two-note chime when a channel closes, a longer rising sweep for the solve,
// and a low sweep down when the board is wiped.

import { CUES, type CueName } from "./constants";
import type { CueSpec } from "./audio-bus";
import type { InitApi, UpdateApi } from "./runtime";
import type { RefractState } from "./game";

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

/** Declare every cue, once, before the first frame. */
export function defineCues(api: Pick<InitApi<RefractState>, "audio">): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS)) {
    api.audio.define(cue, spec);
  }
}

/** What one frame's update raised, each flag one cue played at most once. */
export interface FrameEvents {
  connect: boolean;
  retract: boolean;
  channelComplete: boolean;
  solved: boolean;
  clear: boolean;
}

/**
 * Play the cue for each event this frame raised. A frame that raises more
 * than one plays each of those once; a frame that raises none plays nothing.
 */
export function playFrameEvents(
  api: Pick<UpdateApi, "audio">,
  events: FrameEvents,
): void {
  if (events.connect) api.audio.play(CUES.connect);
  if (events.retract) api.audio.play(CUES.retract);
  if (events.channelComplete) api.audio.play(CUES.channelComplete);
  if (events.solved) api.audio.play(CUES.solved);
  if (events.clear) api.audio.play(CUES.clear);
}
