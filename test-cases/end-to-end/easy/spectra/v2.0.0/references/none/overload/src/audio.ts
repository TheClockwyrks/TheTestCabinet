// Spectra — audio, as runtime cues (specs/ui.md, specs/mode.md).
//
// There is no Web Audio graph here, no mute flag and no autoplay unlock: the
// runtime (`src/audio-bus.ts`) owns the context, the synthesis, the mute state and
// the first-gesture unlock. The game's whole part is to DECLARE the ten cues
// `src/constants.ts` names, once, and then raise them BY NAME as the events happen.
//
// A FRAME PLAYS EACH RAISED CUE ONCE. `specs/ui.md` fixes that: a frame that raises
// more than one cue plays each of those once. A frame divides into as many
// sub-steps as its delta needs, and two shots can leave inside one frame, so cues
// are RAISED into {@link CueQueue} during the sub-steps and FLUSHED once at the end
// of the frame. That is also what keeps the sound sane at a low frame rate.
//
// The ten are pitched and shaped to be told apart by ear: a short bright chirp for a
// shot, a two-note sweep for the flip, a soft swell for an absorb, a falling snap
// for a kill, a long descending roar for the discharge, a rising shimmer for the
// inversion, a low fall for a life lost, a rising chime for a stage, a tiny click
// for a menu move, and a hard buzz for an overload.

import { CUES, type CueName } from "./constants";
import type { CueSpec } from "./audio-bus";
import type { InitApi } from "./runtime";

/** The synthesis behind each of the ten cues. */
export const CUE_SPECS: Readonly<Record<CueName, CueSpec>> = {
  [CUES.fire]: {
    wave: "square",
    freq: 820,
    freqTo: 1280,
    gain: 0.1,
    durationMs: 60,
  },
  [CUES.flip]: {
    wave: "triangle",
    freq: 460,
    freqTo: 900,
    gain: 0.14,
    durationMs: 110,
  },
  [CUES.absorb]: {
    wave: "sine",
    freq: 300,
    freqTo: 620,
    gain: 0.16,
    durationMs: 170,
  },
  [CUES.kill]: {
    wave: "sawtooth",
    freq: 520,
    freqTo: 150,
    gain: 0.15,
    durationMs: 120,
  },
  [CUES.discharge]: {
    wave: "sawtooth",
    freq: 940,
    freqTo: 80,
    gain: 0.2,
    durationMs: 420,
  },
  [CUES.inversion]: {
    wave: "sine",
    freq: 220,
    freqTo: 1760,
    gain: 0.18,
    durationMs: 520,
  },
  [CUES.hit]: {
    wave: "sawtooth",
    freq: 400,
    freqTo: 60,
    gain: 0.2,
    durationMs: 520,
  },
  [CUES.stageClear]: {
    wave: "triangle",
    freq: 560,
    freqTo: 1120,
    gain: 0.18,
    durationMs: 280,
  },
  [CUES.menu]: {
    wave: "square",
    freq: 640,
    freqTo: 680,
    gain: 0.08,
    durationMs: 40,
  },
  [CUES.overload]: {
    wave: "square",
    freq: 180,
    freqTo: 90,
    gain: 0.18,
    durationMs: 220,
  },
};

/** Declare every cue, once, before the first frame. */
export function defineCues(api: InitApi): void {
  for (const [cue, spec] of Object.entries(CUE_SPECS))
    api.audio.define(cue, spec);
}

/** Where the game raises a cue; the queue decides how often it is heard. */
export interface CueSink {
  /** Raise `cue` for this frame. Raising it twice in one frame plays it once. */
  raise(cue: CueName): void;
}

/** A frame's raised cues, each played once when the frame flushes. */
export class CueQueue implements CueSink {
  private readonly raised = new Set<CueName>();

  raise(cue: CueName): void {
    this.raised.add(cue);
  }

  /** Whether `cue` was raised this frame; a pure read, for the build's own tests. */
  has(cue: CueName): boolean {
    return this.raised.has(cue);
  }

  /** Play each raised cue once through `play`, then empty the queue. */
  flush(play: (cue: string) => void): void {
    for (const cue of this.raised) play(cue);
    this.raised.clear();
  }
}
